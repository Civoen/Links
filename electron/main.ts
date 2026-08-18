import { app, BrowserWindow, ipcMain, Menu } from "electron";
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
  deleteLink,
  findTracksMissingArt,
  backfillTrackMetadata
} from "./linkStore";
import { startLinkEngine, stopLinkEngine } from "./linkEngine";
import { getClientId, setClientId } from "./settings";
import { findSuggestedLinks } from "./suggestions";

const PROTOCOL = "links";
let mainWindow: BrowserWindow | null = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 720,
    minWidth: 360,
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
}

function registerProtocolHandling() {
  if (!app.isDefaultProtocolClient(PROTOCOL)) {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }

  app.on("second-instance", (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (url) handleAuthCallback(url).then(() => mainWindow?.webContents.send("auth:updated"));
    mainWindow?.focus();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleAuthCallback(url).then(() => mainWindow?.webContents.send("auth:updated"));
  });
}

/** Forwards a description of what the engine just did to the renderer, for the in-app notification. */
function notifyRendererOfEngineAction(message: string) {
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

  ipcMain.handle("tracks:search", (_event, query: string) => searchTracks(query));

  ipcMain.handle("links:get", () => getLinks());
  ipcMain.handle("links:save", (_event, tracks) => saveLink(tracks));
  ipcMain.handle("links:update", (_event, id: string, tracks) => updateLink(id, tracks));
  ipcMain.handle("links:delete", (_event, id: string) => deleteLink(id));

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

    const fetched = await getTracksByUri(missingUris);
    const metadataByUri = new Map(
      fetched.map((t) => [t.uri, { album: t.album, albumArt: t.albumArt, durationMs: t.durationMs }])
    );

    backfillTrackMetadata(metadataByUri);
  } catch (err) {
    console.error("[backfill] failed:", err);
  }
}

app.whenReady().then(() => {
  // Removes the default File/Edit/View/Window/Help menu bar. Links has no
  // use for it — every action lives in the app's own UI.
  Menu.setApplicationMenu(null);

  registerProtocolHandling();
  registerIpcHandlers();
  createWindow();

  if (isConnected()) {
    startLinkEngine(notifyRendererOfEngineAction);
    backfillMissingAlbumArt();
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopLinkEngine();
    app.quit();
  }
});
