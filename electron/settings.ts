import { app } from "electron";
import fs from "fs";
import path from "path";

interface Settings {
  spotifyClientId: string | null;
  minimizeToTray: boolean;
  showEngineNotifications: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  spotifyClientId: null,
  minimizeToTray: true,
  showEngineNotifications: true
};

const SETTINGS_PATH = () => path.join(app.getPath("userData"), "settings.json");

function readSettings(): Settings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH(), "utf-8");
    // Merge over defaults so a settings file written before a new field
    // existed doesn't come back with that field missing.
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(patch: Partial<Settings>) {
  const current = readSettings();
  const next = { ...current, ...patch };
  fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(next, null, 2), "utf-8");
}

export function getClientId(): string | null {
  return readSettings().spotifyClientId;
}

export function setClientId(clientId: string): void {
  const trimmed = clientId.trim();
  if (!trimmed) throw new Error("Client ID can't be empty");
  writeSettings({ spotifyClientId: trimmed });
}

export function getMinimizeToTray(): boolean {
  return readSettings().minimizeToTray;
}

export function setMinimizeToTray(value: boolean): void {
  writeSettings({ minimizeToTray: value });
}

export function getShowEngineNotifications(): boolean {
  return readSettings().showEngineNotifications;
}

export function setShowEngineNotifications(value: boolean): void {
  writeSettings({ showEngineNotifications: value });
}
