import { app } from "electron";
import fs from "fs";
import path from "path";

/**
 * A link's CURRENT status — deliberately separate from notification
 * history. Notifications are a log of things that happened, meant to be
 * freely cleared without consequence. Health needs to answer a different
 * question entirely: "is this link okay right now" — which shouldn't
 * become inaccurate just because someone cleared their notification
 * history. Before this existed, Health read "the latest notification for
 * this link" directly, so clearing notifications silently cleared
 * Health's warnings too, even when the underlying problem was still
 * genuinely happening.
 */
export interface LinkStatus {
  linkId: string;
  level: "warning" | "info";
  message: string;
  updatedAt: number;
}

const STORE_PATH = () => path.join(app.getPath("userData"), "link-status.json");

function readAll(): Record<string, LinkStatus> {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH(), "utf-8"));
  } catch {
    return {};
  }
}

function writeAll(statuses: Record<string, LinkStatus>) {
  fs.writeFileSync(STORE_PATH(), JSON.stringify(statuses, null, 2), "utf-8");
}

export function getLinkStatus(linkId: string): LinkStatus | null {
  return readAll()[linkId] ?? null;
}

/** level: "warning" means something needs attention; "info" means working normally (including a just-resolved problem). */
export function setLinkStatus(linkId: string, level: "warning" | "info", message: string) {
  const all = readAll();
  all[linkId] = { linkId, level, message, updatedAt: Date.now() };
  writeAll(all);
}

export function clearLinkStatus(linkId: string) {
  const all = readAll();
  delete all[linkId];
  writeAll(all);
}
