import { app } from "electron";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { NotificationLevel } from "./linkEngine";

export interface NotificationEntry {
  id: string;
  timestamp: number;
  message: string;
  level: NotificationLevel;
}

const STORE_PATH = () => path.join(app.getPath("userData"), "notifications.json");

// Keeps the history from growing forever — this is a recent-activity log,
// not a permanent record.
const MAX_ENTRIES = 50;

function readAll(): NotificationEntry[] {
  try {
    const raw = fs.readFileSync(STORE_PATH(), "utf-8");
    return JSON.parse(raw) as NotificationEntry[];
  } catch {
    return [];
  }
}

function writeAll(entries: NotificationEntry[]) {
  fs.writeFileSync(STORE_PATH(), JSON.stringify(entries, null, 2), "utf-8");
}

export function getNotifications(): NotificationEntry[] {
  // Newest first.
  return readAll().sort((a, b) => b.timestamp - a.timestamp);
}

export function addNotification(message: string, level: NotificationLevel): NotificationEntry {
  const entry: NotificationEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    message,
    level
  };

  const entries = readAll();
  entries.push(entry);
  // Trim from the oldest end once over the cap.
  const trimmed = entries
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-MAX_ENTRIES);
  writeAll(trimmed);

  return entry;
}

export function clearNotifications(): void {
  writeAll([]);
}
