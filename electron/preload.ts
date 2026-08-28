import { contextBridge, ipcRenderer } from "electron";
import type { TrackSummary, ConnectionHealth } from "./spotifyApi";
import type { Link } from "./linkStore";
import type { NotificationEntry } from "./notificationStore";

export interface UpdateStatus {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";
  update: { version: string; releaseNotes: string | null } | null;
}

export interface EngineNotification {
  message: string;
  level: "info" | "warning";
  linkId?: string;
  kind?: "orphan";
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
  // can show a brief "here's what just happened" toast. Every one of
  // these is also persisted — see getNotifications/onNewNotification —
  // so muting the toast (via settings) never means losing the history.
  onEngineAction: (callback: (notification: EngineNotification) => void): (() => void) => {
    const listener = (_event: unknown, notification: EngineNotification) => callback(notification);
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

  getLaunchToTray: (): Promise<boolean> => ipcRenderer.invoke("settings:getLaunchToTray"),
  setLaunchToTray: (value: boolean): Promise<void> =>
    ipcRenderer.invoke("settings:setLaunchToTray", value),

  getShowUpdateNotifications: (): Promise<boolean> =>
    ipcRenderer.invoke("settings:getShowUpdateNotifications"),
  setShowUpdateNotifications: (value: boolean): Promise<void> =>
    ipcRenderer.invoke("settings:setShowUpdateNotifications", value),

  getAppVersion: (): Promise<string> => ipcRenderer.invoke("app:getVersion"),
  getReleaseNotes: (): Promise<{
    ok: boolean;
    releases?: { version: string; title: string; body: string; publishedAt: string }[];
    error?: string;
  }> => ipcRenderer.invoke("app:getReleaseNotes"),

  getConnectionHealth: (): Promise<ConnectionHealth> => ipcRenderer.invoke("connection:getHealth"),
  getCurrentContext: (): Promise<{
    isPlaying: boolean;
    contextType: string | null;
    shuffle: boolean;
    observedAt: number;
  } | null> => ipcRenderer.invoke("engine:getCurrentContext"),
  checkConnectionNow: (): Promise<ConnectionHealth> => ipcRenderer.invoke("connection:checkNow"),

  // Fires each time the engine genuinely completes a poll — used to drive
  // a liveness indicator that reflects real activity, not a decorative
  // loop. Deliberately separate from onEngineAction, which only fires
  // when there's something worth telling the user about.
  onEngineTick: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("engine:tick", listener);
    return () => {
      ipcRenderer.removeListener("engine:tick", listener);
    };
  },

  getNotifications: (): Promise<NotificationEntry[]> => ipcRenderer.invoke("notifications:get"),
  clearNotifications: (): Promise<void> => ipcRenderer.invoke("notifications:clear"),
  getLatestNotificationForLink: (linkId: string): Promise<NotificationEntry | null> =>
    ipcRenderer.invoke("notifications:getLatestForLink", linkId),
  onNewNotification: (callback: (notification: EngineNotification) => void): (() => void) => {
    const listener = (_event: unknown, notification: EngineNotification) => callback(notification);
    ipcRenderer.on("notifications:new", listener);
    return () => {
      ipcRenderer.removeListener("notifications:new", listener);
    };
  },

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
  findSiblingTracks: (track: TrackSummary): Promise<TrackSummary[]> =>
    ipcRenderer.invoke("tracks:findSiblings", track),

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
  importLinks: (): Promise<{
    ok: boolean;
    result?: { imported: number; skippedDuplicates: number; skippedInvalid: number };
    settingsImported?: boolean;
    error?: string;
  }> => ipcRenderer.invoke("links:import")
};

contextBridge.exposeInMainWorld("linksAPI", linksAPI);

export type LinksAPI = typeof linksAPI;
