import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { autoUpdater } from "electron-updater";
import {
  startAuth,
  handleAuthCallback,
  isConnected,
  disconnect
} from "./spotifyAuth";
import { searchTracks, getPlaybackState } from "./spotifyApi";
import { getLinks, saveLink, deleteLink } from "./linkStore";
import { startLinkEngine, stopLinkEngine } from "./linkEngine";
import { getClientId, setClientId } from "./settings";

const PROTOCOL = "links";
let mainWindow: BrowserWindow | null = null;

// Only one instance of Links should run at a time — the link engine polls
// Spotify on an interval, and two instances doing that would double up on
// "add to queue" calls.
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

  // Windows/Linux: the OAuth redirect arrives as argv on a second launch,
  // which requestSingleInstanceLock() forwards here instead of opening a
  // second window.
  app.on("second-instance", (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (url) handleAuthCallback(url).then(() => mainWindow?.webContents.send("auth:updated"));
    mainWindow?.focus();
  });

  // macOS: the redirect arrives via this event instead.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleAuthCallback(url).then(() => mainWindow?.webContents.send("auth:updated"));
  });
}

function registerIpcHandlers() {
  ipcMain.handle("auth:isConnected", () => isConnected());

  ipcMain.handle("auth:start", async () => {
    await startAuth();
    startLinkEngine();
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

  ipcMain.handle("links:delete", (_event, id: string) => deleteLink(id));

  ipcMain.handle("playback:get", () => getPlaybackState());
}

app.whenReady().then(() => {
  registerProtocolHandling();
  registerIpcHandlers();
  createWindow();

  if (isConnected()) startLinkEngine();

  if (process.env.NODE_ENV !== "development") {
    // Checks the GitHub Releases feed configured in package.json's "build"
    // block and silently downloads + prompts to install if there's a newer
    // version. No-ops harmlessly if the app isn't running from a real
    // installed build (e.g. during local testing).
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error("[updater] check failed:", err);
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Keep the link engine running in the background on macOS even with no
  // window open, matching the "reliability shouldn't depend on a window
  // being open" architecture decision. Fully quit on Windows/Linux.
  if (process.platform !== "darwin") {
    stopLinkEngine();
    app.quit();
  }
});
