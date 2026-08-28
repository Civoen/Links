import { app } from "electron";
import fs from "fs";
import path from "path";

interface Settings {
  spotifyClientId: string | null;
  minimizeToTray: boolean;
  showEngineNotifications: boolean;
  launchToTray: boolean;
  showUpdateNotifications: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  spotifyClientId: null,
  minimizeToTray: true,
  showEngineNotifications: true,
  launchToTray: false,
  showUpdateNotifications: true
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

export function getLaunchToTray(): boolean {
  return readSettings().launchToTray;
}

export function setLaunchToTray(value: boolean): void {
  writeSettings({ launchToTray: value });
}

export function getShowUpdateNotifications(): boolean {
  return readSettings().showUpdateNotifications;
}

export function setShowUpdateNotifications(value: boolean): void {
  writeSettings({ showUpdateNotifications: value });
}

/** For Export — everything except nothing (there's no per-machine-only setting stored here; launch-at-login lives in the OS's own login items, not this file). */
export function exportSettings(): Settings {
  return readSettings();
}

/**
 * For Import — validates each field individually rather than trusting
 * the whole object, so a partially-malformed settings block doesn't
 * silently wipe out fields that were actually fine. Missing entirely is
 * fine too (an older export, from before settings were included, or a
 * links-only file) — importing settings is a bonus on top of the links
 * themselves, never a requirement for the import to succeed.
 */
export function importSettings(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const r = raw as Record<string, unknown>;
  const patch: Partial<Settings> = {};

  if (typeof r.spotifyClientId === "string" && r.spotifyClientId.trim()) {
    patch.spotifyClientId = r.spotifyClientId.trim();
  }
  if (typeof r.minimizeToTray === "boolean") patch.minimizeToTray = r.minimizeToTray;
  if (typeof r.showEngineNotifications === "boolean") patch.showEngineNotifications = r.showEngineNotifications;
  if (typeof r.launchToTray === "boolean") patch.launchToTray = r.launchToTray;
  if (typeof r.showUpdateNotifications === "boolean") patch.showUpdateNotifications = r.showUpdateNotifications;

  if (Object.keys(patch).length > 0) writeSettings(patch);
}
