import { contextBridge, ipcRenderer } from "electron";
import type { TrackSummary, PlaylistSummary } from "./spotifyApi";
import type { Link } from "./linkStore";
import type { SuggestedLink } from "./suggestions";

export interface UpdateStatus {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";
  update: { version: string; releaseNotes: string | null } | null;
}

const linksAPI = {
  isConnected: (): Promise<boolean> => ipcRenderer.invoke("auth:isConnected"),
  startAuth: (): Promise<boolean> => ipcRenderer.invoke("auth:start"),
  disconnect: (): Promise<void> => ipcRenderer.invoke("auth:disconnect"),
  onAuthUpdated: (callback: () => void): (() => void) => {
    ipcRenderer.on("auth:updated", callback);
    return () => {
      ipcRenderer.removeListener("auth:updated", callback);
    };
  },

  // Fires whenever the link engine actually queues something, so the UI
  // can show a brief "here's what just happened" notification.
  onEngineAction: (callback: (message: string) => void): (() => void) => {
    const listener = (_event: unknown, message: string) => callback(message);
    ipcRenderer.on("engine:action", listener);
    return () => {
      ipcRenderer.removeListener("engine:action", listener);
    };
  },

  getClientId: (): Promise<string | null> => ipcRenderer.invoke("settings:getClientId"),
  setClientId: (clientId: string): Promise<void> =>
    ipcRenderer.invoke("settings:setClientId", clientId),

  getMinimizeToTray: (): Promise<boolean> => ipcRenderer.invoke("settings:getMinimizeToTray"),
  setMinimizeToTray: (value: boolean): Promise<void> =>
    ipcRenderer.invoke("settings:setMinimizeToTray", value),

  getShowEngineNotifications: (): Promise<boolean> =>
    ipcRenderer.invoke("settings:getShowEngineNotifications"),
  setShowEngineNotifications: (value: boolean): Promise<void> =>
    ipcRenderer.invoke("settings:setShowEngineNotifications", value),

  getLaunchAtLogin: (): Promise<boolean> => ipcRenderer.invoke("settings:getLaunchAtLogin"),
  setLaunchAtLogin: (value: boolean): Promise<void> =>
    ipcRenderer.invoke("settings:setLaunchAtLogin", value),

  getAppVersion: (): Promise<string> => ipcRenderer.invoke("app:getVersion"),

  getUpdateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke("updater:getStatus"),
  checkForUpdatesNow: (): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke("updater:checkNow"),
  installUpdate: (): Promise<void> => ipcRenderer.invoke("updater:install"),
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: UpdateStatus) => callback(status);
    ipcRenderer.on("updater:status", listener);
    return () => {
      ipcRenderer.removeListener("updater:status", listener);
    };
  },

  searchTracks: (query: string): Promise<TrackSummary[]> =>
    ipcRenderer.invoke("tracks:search", query),

  getLinks: (): Promise<Link[]> => ipcRenderer.invoke("links:get"),
  saveLink: (tracks: TrackSummary[], title?: string): Promise<Link> =>
    ipcRenderer.invoke("links:save", tracks, title),
  updateLink: (id: string, tracks: TrackSummary[], title?: string): Promise<void> =>
    ipcRenderer.invoke("links:update", id, tracks, title),
  setLinkActive: (id: string, active: boolean): Promise<void> =>
    ipcRenderer.invoke("links:setActive", id, active),
  deleteLink: (id: string): Promise<void> => ipcRenderer.invoke("links:delete", id),
  clearAllLinks: (): Promise<void> => ipcRenderer.invoke("links:clearAll"),
  reorderLinks: (orderedIds: string[]): Promise<void> =>
    ipcRenderer.invoke("links:reorder", orderedIds),
  findDuplicateLink: (tracks: TrackSummary[], excludeId?: string): Promise<Link | null> =>
    ipcRenderer.invoke("links:findDuplicate", tracks, excludeId),
  getBrokenTrackUris: (): Promise<string[]> => ipcRenderer.invoke("links:getBrokenTrackUris"),
  recheckBrokenTrackUris: (): Promise<string[]> =>
    ipcRenderer.invoke("links:recheckBrokenTrackUris"),
  exportLinks: (): Promise<{ ok: boolean; filePath?: string }> =>
    ipcRenderer.invoke("links:export"),

  getPlaylists: (): Promise<PlaylistSummary[]> => ipcRenderer.invoke("playlists:list"),
  getSuggestions: (playlistId: string): Promise<SuggestedLink[]> =>
    ipcRenderer.invoke("playlists:suggestions", playlistId)
};

contextBridge.exposeInMainWorld("linksAPI", linksAPI);

export type LinksAPI = typeof linksAPI;
