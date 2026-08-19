import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, dialog } from "electron";
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
  getUserPlaylists,
  getPlaylistTracks
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
  backfillTrackMetadata
} from "./linkStore";
import { findBrokenTrackUris } from "./linkHealth";
import { startLinkEngine, stopLinkEngine } from "./linkEngine";
import {
  getClientId,
  setClientId,
  getMinimizeToTray,
  setMinimizeToTray,
  getShowEngineNotifications,
  setShowEngineNotifications
} from "./settings";
import { findSuggestedLinks } from "./suggestions";
import type { TrackSummary } from "./spotifyApi";

const PROTOCOL = "links";
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Distinguishes "user clicked X" (which should respect the minimize-to-tray
// setting) from "actually quitting" (via the tray menu, or the OS shutting
// the app down) — the latter must always close the window for real,
// regardless of the setting, or Quit would never work.
let isQuitting = false;

// Populated once at startup by checkForBrokenLinks() below. Not persisted —
// recomputed fresh each launch, since "is this track still on Spotify" can
// only change from Spotify's side, not ours.
let brokenTrackUris: Set<string> = new Set();

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 680,
    height: 760,
    minWidth: 560,
    minHeight: 480,
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
  const iconPath = path.join(__dirname, "../build/icon.png");
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
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

/** Forwards a description of what the engine just did to the renderer, for the in-app notification. */
function notifyRendererOfEngineAction(message: string) {
  if (!getShowEngineNotifications()) return;
  mainWindow?.webContents.send("engine:action", message);
}

function registerIpcHandlers() {
  ipcMain.handle("auth:isConnected", () => isConnected());

  ipcMain.handle("auth:start", async () => {
    await startAuth();
    startLinkEngine(notifyRendererOfEngineAction);
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

  ipcMain.handle("settings:getLaunchAtLogin", () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle("settings:setLaunchAtLogin", (_event, value: boolean) => {
    app.setLoginItemSettings({ openAtLogin: value });
  });

  ipcMain.handle("tracks:search", (_event, query: string) => searchTracks(query));

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

    fs.writeFileSync(filePath, JSON.stringify(getLinks(), null, 2), "utf-8");
    return { ok: true, filePath };
  });

  ipcMain.handle("playback:get", () => getPlaybackState());

  ipcMain.handle("playlists:list", () => getUserPlaylists());
  ipcMain.handle("playlists:suggestions", async (_event, playlistId: string) => {
    const tracks = await getPlaylistTracks(playlistId);
    return findSuggestedLinks(tracks);
  });
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

app.whenReady().then(() => {
  // Removes the default File/Edit/View/Window/Help menu bar. Links has no
  // use for it — every action lives in the app's own UI.
  Menu.setApplicationMenu(null);

  registerProtocolHandling();
  registerIpcHandlers();
  createWindow();
  createTray();

  if (isConnected()) {
    startLinkEngine(notifyRendererOfEngineAction);
    // Sequenced, not fired together — both of these batch-fetch tracks
    // from Spotify, and running them at the same moment right after
    // startup was exactly what made the broken-link check prone to
    // hitting rate limits and false-flagging playable tracks.
    backfillMissingAlbumArt().then(() => checkForBrokenLinks());
  }

  if (process.env.NODE_ENV !== "development") {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error("[updater] check failed:", err);
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Fires before any window-closing happens, regardless of which quit path
// triggered it (tray "Quit", OS shutdown, etc.) — the single place that
// marks a real quit as real, so the window's close handler above knows
// not to intercept it.
app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopLinkEngine();
    app.quit();
  }
});
