import { contextBridge, ipcRenderer } from "electron";
import type { TrackSummary } from "./spotifyApi";
import type { Link } from "./linkStore";

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

  getClientId: (): Promise<string | null> => ipcRenderer.invoke("settings:getClientId"),
  setClientId: (clientId: string): Promise<void> =>
    ipcRenderer.invoke("settings:setClientId", clientId),

  searchTracks: (query: string): Promise<TrackSummary[]> =>
    ipcRenderer.invoke("tracks:search", query),

  getLinks: (): Promise<Link[]> => ipcRenderer.invoke("links:get"),
  saveLink: (tracks: TrackSummary[]): Promise<Link> =>
    ipcRenderer.invoke("links:save", tracks),
  deleteLink: (id: string): Promise<void> => ipcRenderer.invoke("links:delete", id)
};

contextBridge.exposeInMainWorld("linksAPI", linksAPI);

export type LinksAPI = typeof linksAPI;
