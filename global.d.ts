import type { LinksAPI } from "../electron/preload";

declare global {
  interface Window {
    linksAPI: LinksAPI;
  }
}

export {};
