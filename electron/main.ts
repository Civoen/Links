import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, dialog, Notification } from "electron";
import fs from "fs";
import path from "path";
import { autoUpdater } from "electron-updater";
import {
  startAuth,
  handleAuthCallback,
  isConnected,
  disconnect
} from "./spotifyAuth";
import {
  searchTracks,
  getPlaybackState,
  getTracksByUri,
  checkConnectionHealth,
  type ConnectionHealth
} from "./spotifyApi";
import {
  getLinks,
  saveLink,
  updateLink,
  setLinkActive,
  deleteLink,
  clearAllLinks,
  reorderLinks,
  findDuplicateLink,
  findTracksMissingArt,
  backfillTrackMetadata,
  importLinks
} from "./linkStore";
import { findBrokenTrackUris } from "./linkHealth";
import {
  startLinkEngine,
  stopLinkEngine,
  getCurrentContext,
  revalidateOrphanWarnings,
  type NotificationLevel
} from "./linkEngine";
import {
  getNotifications,
  addNotification,
  clearNotifications,
  getLatestNotificationForLink,
  getLinkIdsWithUnresolvedOrphanWarning
} from "./notificationStore";
import {
  getClientId,
  setClientId,
  getMinimizeToTray,
  setMinimizeToTray,
  getShowEngineNotifications,
  setShowEngineNotifications,
  getLaunchToTray,
  setLaunchToTray,
  getShowUpdateNotifications,
  setShowUpdateNotifications,
  exportSettings,
  importSettings
} from "./settings";
import { findSiblingTracks } from "./suggestions";
import type { TrackSummary } from "./spotifyApi";

const PROTOCOL = "links";
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Distinguishes "user clicked X" (which should respect the minimize-to-tray
// setting) from "actually quitting" (via the tray menu, an installed update
// restarting the app, or the OS shutting the app down) — the latter must
// always close the window for real, regardless of the setting.
let isQuitting = false;

// Populated once at startup by checkForBrokenLinks() below. Not persisted —
// recomputed fresh each launch, since "is this track still on Spotify" can
// only change from Spotify's side, not ours.
let brokenTrackUris: Set<string> = new Set();

// Populated at startup and on-demand via Settings — whether the current
// connection can actually reach Spotify, not just "does a token exist".
let connectionHealth: ConnectionHealth = { ok: true };

// How often to re-check for updates while the app stays running. Since
// minimize-to-tray is on by default, Links can realistically stay resident
// for days — checking once at launch and never again would mean someone
// could sit on an old version indefinitely without knowing a fix shipped.
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

// Shorter than the update interval on purpose — a degraded connection
// silently breaks the core feature (nothing gets queued), whereas a
// missed update check just means running an older version a bit longer.
// Worth catching sooner. Round 12 finding: this check previously only
// ran once at startup and on-demand from Settings, so a connection that
// degraded hours into a long-running tray session (which is the normal
// case, since minimize-to-tray defaults on) wouldn't be proactively
// noticed by this check at all — only by the core engine's own failure
// warnings once something actually broke.
const CONNECTION_HEALTH_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

interface UpdateInfo {
  version: string;
  releaseNotes: string | null;
}

let updateStatus: "idle" | "checking" | "available" | "downloading" | "downloaded" | "error" = "idle";
let pendingUpdate: UpdateInfo | null = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function createWindow(startHidden = false) {
  mainWindow = new BrowserWindow({
    width: 680,
    height: 760,
    minWidth: 560,
    minHeight: 480,
    show: !startHidden,
    icon: path.join(__dirname, "../build/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("close", (event) => {
    if (isQuitting) return; // let a real quit proceed normally

    if (getMinimizeToTray()) {
      event.preventDefault();
      mainWindow?.hide();
    }
    // If the setting is off, do nothing here — the close proceeds as
    // normal, which triggers window-all-closed below.
  });
}

function createTray() {
  const iconPath = path.join(__dirname, "../build/tray-icon.png");
  const trayIcon = nativeImage.createFromPath(iconPath);
  tray = new Tray(trayIcon);
  tray.setToolTip("Links");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Links",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    if (mainWindow?.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

function registerProtocolHandling() {
  if (!app.isDefaultProtocolClient(PROTOCOL)) {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }

  app.on("second-instance", (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (url) handleAuthCallback(url).then(() => mainWindow?.webContents.send("auth:updated"));
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleAuthCallback(url).then(() => mainWindow?.webContents.send("auth:updated"));
  });
}

/**
 * Shows a native OS notification (Windows Toast, macOS Notification
 * Center, Linux's own system) — added specifically because the in-app
 * toast is only visible while the window is open and focused, which
 * defeats the point for an app whose whole design is running quietly in
 * the background. Only fires when the window genuinely isn't focused;
 * when it is, the in-app toast already covers the same moment, and
 * showing both would just be redundant. The exact on-screen position is
 * governed by the OS's own notification settings, not something Links
 * can control.
 */
function showDesktopNotification(message: string, level: NotificationLevel) {
  if (!Notification.isSupported()) return;
  if (mainWindow?.isFocused()) return;

  const notification = new Notification({
    title: "Links",
    body: message,
    icon: path.join(__dirname, "../build/icon.png"),
    silent: level === "info" // routine "queued a track" pings stay quiet; warnings get the OS's normal notification sound
  });

  notification.on("click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  notification.show();
}

/** Persists every engine notification (with which link it's about, if any), and forwards it to the renderer for the toast (unless toasts are muted) — and, if the window isn't focused, to the OS as a real desktop notification too. */
function notifyRendererOfEngineAction(
  message: string,
  level: NotificationLevel,
  linkId?: string,
  kind?: "orphan"
) {
  addNotification(message, level, linkId, kind);
  mainWindow?.webContents.send("notifications:new", { message, level, linkId, kind });

  if (!getShowEngineNotifications()) return;
  mainWindow?.webContents.send("engine:action", { message, level, linkId, kind });
  showDesktopNotification(message, level);
}

/** Forwards each genuinely-completed poll to the renderer, for a liveness indicator that reflects real activity. */
function notifyRendererOfTick() {
  mainWindow?.webContents.send("engine:tick");
}

/** electron-updater's releaseNotes can be a plain string or a per-version array — normalize to one string. */
function normalizeReleaseNotes(notes: unknown): string | null {
  if (!notes) return null;
  if (typeof notes === "string") return notes;
  if (Array.isArray(notes)) {
    return notes
      .map((entry) => (typeof entry === "object" && entry && "note" in entry ? String((entry as any).note ?? "") : ""))
      .filter(Boolean)
      .join("\n\n");
  }
  return null;
}

function sendUpdateStatus() {
  mainWindow?.webContents.send("updater:status", { status: updateStatus, update: pendingUpdate });
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;

  autoUpdater.on("checking-for-update", () => {
    updateStatus = "checking";
    sendUpdateStatus();
  });

  autoUpdater.on("update-available", (info) => {
    updateStatus = "downloading";
    pendingUpdate = { version: info.version, releaseNotes: normalizeReleaseNotes(info.releaseNotes) };
    sendUpdateStatus();
  });

  autoUpdater.on("update-not-available", () => {
    updateStatus = "idle";
    pendingUpdate = null;
    sendUpdateStatus();
  });

  autoUpdater.on("update-downloaded", (info) => {
    updateStatus = "downloaded";
    pendingUpdate = { version: info.version, releaseNotes: normalizeReleaseNotes(info.releaseNotes) };
    sendUpdateStatus();

    if (getShowUpdateNotifications()) {
      showDesktopNotification(`Version ${info.version} is ready to install.`, "info");
    }
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater] error:", err);
    updateStatus = "error";
    sendUpdateStatus();
  });
}

interface ReleaseNote {
  version: string;
  title: string;
  body: string;
  publishedAt: string;
}

let cachedReleaseNotes: ReleaseNote[] | null = null;
let releaseNotesFetchedAt: number | null = null;
const RELEASE_NOTES_CACHE_MS = 10 * 60 * 1000; // avoid re-hitting GitHub's API on every About page visit

/**
 * Reads release title/description directly from GitHub's public Releases
 * API for this repo — no auth needed for a public repo's release list,
 * within GitHub's standard unauthenticated rate limit. Cached for a short
 * while since this only needs to be roughly current, not live on every
 * visit to the About page.
 */
async function fetchReleaseNotes(): Promise<ReleaseNote[]> {
  if (cachedReleaseNotes && releaseNotesFetchedAt && Date.now() - releaseNotesFetchedAt < RELEASE_NOTES_CACHE_MS) {
    return cachedReleaseNotes;
  }

  const res = await fetch("https://api.github.com/repos/Civoen/Links/releases", {
    headers: { Accept: "application/vnd.github+json" }
  });
  if (!res.ok) throw new Error(`GitHub releases request failed: ${res.status}`);

  const json = await res.json();
  if (!Array.isArray(json)) throw new Error("Unexpected response shape from GitHub");

  const notes: ReleaseNote[] = json
    .filter((r: any) => !r.draft)
    .map((r: any) => ({
      version: typeof r.tag_name === "string" ? r.tag_name : "",
      title: typeof r.name === "string" && r.name ? r.name : r.tag_name,
      body: typeof r.body === "string" ? r.body : "",
      publishedAt: typeof r.published_at === "string" ? r.published_at : ""
    }));

  cachedReleaseNotes = notes;
  releaseNotesFetchedAt = Date.now();
  return notes;
}

function checkForUpdates() {
  if (process.env.NODE_ENV === "development") return;
  autoUpdater.checkForUpdates().catch((err) => {
    console.error("[updater] check failed:", err);
  });
}

function registerIpcHandlers() {
  ipcMain.handle("auth:isConnected", () => isConnected());

  ipcMain.handle("auth:start", async () => {
    await startAuth();
    startLinkEngine(notifyRendererOfEngineAction, notifyRendererOfTick);
    return true;
  });

  ipcMain.handle("auth:disconnect", () => {
    disconnect();
    stopLinkEngine();
  });

  ipcMain.handle("settings:getClientId", () => getClientId());
  ipcMain.handle("settings:setClientId", (_event, clientId: string) => setClientId(clientId));

  ipcMain.handle("settings:getMinimizeToTray", () => getMinimizeToTray());
  ipcMain.handle("settings:setMinimizeToTray", (_event, value: boolean) => setMinimizeToTray(value));

  ipcMain.handle("settings:getShowEngineNotifications", () => getShowEngineNotifications());
  ipcMain.handle("settings:setShowEngineNotifications", (_event, value: boolean) =>
    setShowEngineNotifications(value)
  );

  ipcMain.handle("settings:getLaunchToTray", () => getLaunchToTray());
  ipcMain.handle("settings:setLaunchToTray", (_event, value: boolean) => setLaunchToTray(value));

  ipcMain.handle("settings:getShowUpdateNotifications", () => getShowUpdateNotifications());
  ipcMain.handle("settings:setShowUpdateNotifications", (_event, value: boolean) =>
    setShowUpdateNotifications(value)
  );

  ipcMain.handle("settings:getLaunchAtLogin", () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle("settings:setLaunchAtLogin", (_event, value: boolean) => {
    app.setLoginItemSettings({ openAtLogin: value });
  });

  ipcMain.handle("app:getVersion", () => app.getVersion());
  ipcMain.handle("app:getReleaseNotes", async () => {
    try {
      const releases = await fetchReleaseNotes();
      return { ok: true, releases };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Couldn't reach GitHub." };
    }
  });

  ipcMain.handle("connection:getHealth", () => connectionHealth);
  ipcMain.handle("engine:getCurrentContext", () => getCurrentContext());
  ipcMain.handle("connection:checkNow", async () => {
    await checkAndReportConnectionHealth();
    return connectionHealth;
  });

  ipcMain.handle("notifications:get", () => getNotifications());
  ipcMain.handle("notifications:clear", () => clearNotifications());
  ipcMain.handle("notifications:getLatestForLink", (_event, linkId: string) =>
    getLatestNotificationForLink(linkId)
  );

  ipcMain.handle("updater:getStatus", () => ({ status: updateStatus, update: pendingUpdate }));

  ipcMain.handle("updater:checkNow", () => {
    if (process.env.NODE_ENV === "development") {
      return { ok: false, reason: "Updates aren't available in development mode." };
    }
    checkForUpdates();
    return { ok: true };
  });

  ipcMain.handle("updater:install", () => {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle("tracks:search", (_event, query: string) => searchTracks(query));
  ipcMain.handle("tracks:findSiblings", (_event, track: TrackSummary) => findSiblingTracks(track));

  ipcMain.handle("links:get", () => getLinks());
  ipcMain.handle("links:save", (_event, tracks, title?: string) => saveLink(tracks, title));
  ipcMain.handle("links:update", (_event, id: string, tracks, title?: string) => updateLink(id, tracks, title));
  ipcMain.handle("links:setActive", (_event, id: string, active: boolean) => setLinkActive(id, active));
  ipcMain.handle("links:delete", (_event, id: string) => deleteLink(id));
  ipcMain.handle("links:clearAll", () => clearAllLinks());
  ipcMain.handle("links:reorder", (_event, orderedIds: string[]) => reorderLinks(orderedIds));

  ipcMain.handle("links:findDuplicate", (_event, tracks: TrackSummary[], excludeId?: string) =>
    findDuplicateLink(tracks, excludeId)
  );

  ipcMain.handle("links:getBrokenTrackUris", () => [...brokenTrackUris]);
  ipcMain.handle("links:recheckBrokenTrackUris", async () => {
    brokenTrackUris = await findBrokenTrackUris();
    // Also re-validate any orphan warnings that might have gone stale
    // since they were last checked — the poll loop's own resolution
    // detection can't catch a resolution that happened while the app
    // wasn't actively tracking that link (e.g. across a restart), so
    // Recheck gives a direct, on-demand way to fix a lingering warning
    // right now, not just prevent future ones.
    if (isConnected()) {
      try {
        await revalidateOrphanWarnings(getLinkIdsWithUnresolvedOrphanWarning());
      } catch (err) {
        console.error("[main] orphan re-validation during recheck failed:", err);
      }
    }
    return [...brokenTrackUris];
  });

  ipcMain.handle("links:export", async () => {
    if (!mainWindow) return { ok: false };

    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: "Export Links",
      defaultPath: "links-backup.json",
      filters: [{ name: "JSON", extensions: ["json"] }]
    });

    if (canceled || !filePath) return { ok: false };

    const payload = { links: getLinks(), settings: exportSettings() };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
    return { ok: true, filePath };
  });

  ipcMain.handle("links:import", async () => {
    if (!mainWindow) return { ok: false };

    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: "Import Links",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"]
    });

    if (canceled || filePaths.length === 0) return { ok: false };

    try {
      const content = fs.readFileSync(filePaths[0], "utf-8");
      const parsed = JSON.parse(content);

      // Backward-compatible with files exported before settings were
      // included, which were just a raw array of links with no wrapper.
      const linksData = Array.isArray(parsed) ? parsed : parsed?.links;
      const settingsData = Array.isArray(parsed) ? null : parsed?.settings;

      const result = importLinks(linksData);
      if (settingsData) importSettings(settingsData);

      return { ok: true, result, settingsImported: Boolean(settingsData) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Couldn't read that file." };
    }
  });

  ipcMain.handle("playback:get", () => getPlaybackState());
}

/**
 * One-time cleanup for links saved before album art/duration were
 * tracked: finds any track missing that data, fetches it from Spotify,
 * and patches storage. Runs once on startup; after the first successful
 * pass every link has the data going forward, so this becomes a fast
 * no-op on future launches.
 */
async function backfillMissingAlbumArt() {
  try {
    const missingUris = findTracksMissingArt();
    if (missingUris.length === 0) return;

    const { found } = await getTracksByUri(missingUris);
    const metadataByUri = new Map(
      found.map((t) => [t.uri, { album: t.album, albumArt: t.albumArt, durationMs: t.durationMs }])
    );

    backfillTrackMetadata(metadataByUri);
  } catch (err) {
    console.error("[backfill] failed:", err);
  }
}

/**
 * Checks every track across every link against Spotify and remembers which
 * ones are no longer there, so the UI can flag affected links. Runs once
 * at startup — not persisted, not polled continuously, since this is a
 * "does this still exist" check, not something the poll loop needs to
 * repeat every few seconds.
 */
async function checkForBrokenLinks() {
  brokenTrackUris = await findBrokenTrackUris();
}

/**
 * Verifies the connection can actually reach Spotify, not just that a
 * token exists. Runs at startup, and again on-demand from Settings. If
 * something's wrong, warns once so the person finds out from Links
 * rather than only discovering it when a link quietly stops working.
 */
async function checkAndReportConnectionHealth() {
  const wasOk = connectionHealth.ok;
  connectionHealth = await checkConnectionHealth();

  if (!connectionHealth.ok && wasOk) {
    const message =
      connectionHealth.reason === "auth"
        ? "Links can't reach your Spotify account right now. Go to Settings, disconnect, then reconnect to restore it."
        : "Links couldn't reach Spotify just now. This usually resolves on its own, Links will keep checking.";
    notifyRendererOfEngineAction(message, "warning");
  }
}

// Must match package.json's build.appId exactly. Windows uses this to
// decide which app a toast notification is "from" — without it, Electron
// only sets this automatically when Squirrel.Windows is detected, which
// isn't what this app's NSIS-based installer uses, so notifications would
// otherwise risk showing up attributed to generic "Electron" rather than
// "Links". Set as early as possible, before anything else runs.
if (process.platform === "win32") {
  app.setAppUserModelId("app.links.desktop");
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  registerProtocolHandling();
  registerIpcHandlers();
  setupAutoUpdater();
  createWindow(getLaunchToTray());
  createTray();

  if (isConnected()) {
    startLinkEngine(notifyRendererOfEngineAction, notifyRendererOfTick);
    backfillMissingAlbumArt().then(() => checkForBrokenLinks());
    checkAndReportConnectionHealth();
    // Catches exactly the case where an orphan warning's underlying
    // situation resolved while the app wasn't running to notice —
    // the poll loop's own resolution detection only works within a
    // continuous session, since its bookkeeping lives in memory.
    revalidateOrphanWarnings(getLinkIdsWithUnresolvedOrphanWarning()).catch((err) => {
      console.error("[main] orphan re-validation at startup failed:", err);
    });
    setInterval(() => {
      if (isConnected()) checkAndReportConnectionHealth();
    }, CONNECTION_HEALTH_CHECK_INTERVAL_MS);
  }

  checkForUpdates();
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopLinkEngine();
    app.quit();
  }
});
