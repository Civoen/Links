import { app } from "electron";
import fs from "fs";
import path from "path";

interface Settings {
  spotifyClientId: string | null;
}

const SETTINGS_PATH = () => path.join(app.getPath("userData"), "settings.json");

function readSettings(): Settings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH(), "utf-8");
    return JSON.parse(raw) as Settings;
  } catch {
    return { spotifyClientId: null };
  }
}

function writeSettings(settings: Settings) {
  fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(settings, null, 2), "utf-8");
}

export function getClientId(): string | null {
  return readSettings().spotifyClientId;
}

export function setClientId(clientId: string): void {
  const trimmed = clientId.trim();
  if (!trimmed) throw new Error("Client ID can't be empty");
  writeSettings({ spotifyClientId: trimmed });
}
