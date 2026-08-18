import { contextBridge, ipcRenderer } from "electron";
import type { TrackSummary, PlaylistSummary } from "./spotifyApi";
import type { Link } from "./linkStore";
import type { SuggestedLink } from "./suggestions";

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

  searchTracks: (query: string): Promise<TrackSummary[]> =>
    ipcRenderer.invoke("tracks:search", query),

  getLinks: (): Promise<Link[]> => ipcRenderer.invoke("links:get"),
  saveLink: (tracks: TrackSummary[]): Promise<Link> =>
    ipcRenderer.invoke("links:save", tracks),
  updateLink: (id: string, tracks: TrackSummary[]): Promise<void> =>
    ipcRenderer.invoke("links:update", id, tracks),
  deleteLink: (id: string): Promise<void> => ipcRenderer.invoke("links:delete", id),

  getPlaylists: (): Promise<PlaylistSummary[]> => ipcRenderer.invoke("playlists:list"),
  getSuggestions: (playlistId: string): Promise<SuggestedLink[]> =>
    ipcRenderer.invoke("playlists:suggestions", playlistId)
};

contextBridge.exposeInMainWorld("linksAPI", linksAPI);

export type LinksAPI = typeof linksAPI;
