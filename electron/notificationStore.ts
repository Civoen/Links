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
  linkId?: string; // present when the event is attributable to one specific link
  kind?: "orphan"; // present specifically for orphan-queue warnings, so they can be reliably re-validated later without text-matching the message
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

/** Most recent notification for a specific link, if any exist yet. */
export function getLatestNotificationForLink(linkId: string): NotificationEntry | null {
  const forLink = readAll()
    .filter((n) => n.linkId === linkId)
    .sort((a, b) => b.timestamp - a.timestamp);
  return forLink[0] ?? null;
}

/**
 * Link IDs whose most recent notification is an unresolved orphan
 * warning — used to re-validate those specific warnings against the
 * live queue (see revalidateOrphanWarnings in linkEngine.ts), since the
 * poll loop's own bookkeeping that would normally detect a resolution is
 * kept only in memory and doesn't survive an app restart.
 */
export function getLinkIdsWithUnresolvedOrphanWarning(): string[] {
  const latestByLink = new Map<string, NotificationEntry>();
  for (const entry of readAll().sort((a, b) => a.timestamp - b.timestamp)) {
    if (entry.linkId) latestByLink.set(entry.linkId, entry);
  }
  return [...latestByLink.values()]
    .filter((n) => n.kind === "orphan" && n.level === "warning")
    .map((n) => n.linkId!);
}

export function addNotification(
  message: string,
  level: NotificationLevel,
  linkId?: string,
  kind?: "orphan"
): NotificationEntry {
  const entry: NotificationEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    message,
    level,
    linkId,
    kind
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
