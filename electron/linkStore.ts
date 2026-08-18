import { app } from "electron";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { TrackSummary } from "./spotifyApi";

export interface Link {
  id: string;
  title?: string; // optional user-given name; falls back to an auto-generated one when absent
  tracks: TrackSummary[]; // ordered: tracks[0] must precede tracks[1], etc.
  active: boolean; // when false, the engine skips this link entirely
  createdAt: number;
}

const STORE_PATH = () => path.join(app.getPath("userData"), "links.json");

function readAll(): Link[] {
  try {
    const raw = fs.readFileSync(STORE_PATH(), "utf-8");
    const parsed = JSON.parse(raw) as Link[];
    // Links saved before "active" existed come back without it — default
    // them to active so nothing that used to work silently stops.
    return parsed.map((link) => ({ ...link, active: link.active ?? true }));
  } catch {
    return [];
  }
}

function writeAll(links: Link[]) {
  fs.writeFileSync(STORE_PATH(), JSON.stringify(links, null, 2), "utf-8");
}

export function getLinks(): Link[] {
  return readAll();
}

export function saveLink(tracks: TrackSummary[], title?: string): Link {
  if (tracks.length < 2) {
    throw new Error("A link needs at least two tracks");
  }

  const link: Link = {
    id: crypto.randomUUID(),
    title: title?.trim() || undefined,
    tracks,
    active: true,
    createdAt: Date.now()
  };

  const links = readAll();
  links.push(link);
  writeAll(links);
  return link;
}

export function updateLink(id: string, tracks: TrackSummary[], title?: string): void {
  if (tracks.length < 2) {
    throw new Error("A link needs at least two tracks");
  }

  const links = readAll();
  const index = links.findIndex((l) => l.id === id);
  if (index === -1) throw new Error("Link not found");

  links[index] = { ...links[index], tracks, title: title?.trim() || undefined };
  writeAll(links);
}

export function setLinkActive(id: string, active: boolean): void {
  const links = readAll();
  const index = links.findIndex((l) => l.id === id);
  if (index === -1) throw new Error("Link not found");

  links[index] = { ...links[index], active };
  writeAll(links);
}

export function deleteLink(id: string): void {
  writeAll(readAll().filter((l) => l.id !== id));
}

export function clearAllLinks(): void {
  writeAll([]);
}

/**
 * Reorders the whole list to match the given id sequence. Any id from the
 * current list that's missing from orderedIds is kept, appended at the
 * end in its original relative order — a defensive fallback so a stale or
 * incomplete id list from the renderer can never silently drop a link.
 */
export function reorderLinks(orderedIds: string[]): void {
  const links = readAll();
  const byId = new Map(links.map((l) => [l.id, l]));

  const reordered: Link[] = [];
  for (const id of orderedIds) {
    const link = byId.get(id);
    if (link) {
      reordered.push(link);
      byId.delete(id);
    }
  }
  // Anything left in byId wasn't in orderedIds — preserve it rather than lose it.
  reordered.push(...byId.values());

  writeAll(reordered);
}

/** Finds the link (if any) containing this track, and that track's position in it. */
export function findLinkByTrackUri(
  trackUri: string
): { link: Link; index: number } | null {
  for (const link of readAll()) {
    const index = link.tracks.findIndex((t) => t.uri === trackUri);
    if (index !== -1) return { link, index };
  }
  return null;
}

/**
 * Finds an existing link (other than excludeId, when editing) whose track
 * sequence is exactly the same set of URIs in exactly the same order.
 * Deliberately strict — this catches "I built this exact chain already,"
 * not "these chains overlap," which would flag too many legitimate cases
 * (e.g. two different links that both happen to start with the same track).
 */
export function findDuplicateLink(tracks: TrackSummary[], excludeId?: string): Link | null {
  const uris = tracks.map((t) => t.uri);
  for (const link of readAll()) {
    if (link.id === excludeId) continue;
    if (link.tracks.length !== uris.length) continue;
    if (link.tracks.every((t, i) => t.uri === uris[i])) return link;
  }
  return null;
}

/**
 * Fills in album art/album name/duration for tracks saved before those
 * fields existed. Takes a map of URI -> metadata (built by fetching from
 * Spotify) and patches every stored link that has a matching track
 * missing that data, writing back once.
 */
export function backfillTrackMetadata(
  metadataByUri: Map<string, Pick<TrackSummary, "album" | "albumArt" | "durationMs">>
): void {
  if (metadataByUri.size === 0) return;

  const links = readAll();
  let changed = false;

  for (const link of links) {
    for (const track of link.tracks) {
      if (track.albumArt) continue;
      const meta = metadataByUri.get(track.uri);
      if (!meta) continue;
      Object.assign(track, meta);
      changed = true;
    }
  }

  if (changed) writeAll(links);
}

/** Every track URI, across all links, that's missing album art. */
export function findTracksMissingArt(): string[] {
  const uris = new Set<string>();
  for (const link of readAll()) {
    for (const track of link.tracks) {
      if (!track.albumArt) uris.add(track.uri);
    }
  }
  return [...uris];
}

/** Every distinct track URI across all links — used to check for broken/removed tracks. */
export function getAllTrackUris(): string[] {
  const uris = new Set<string>();
  for (const link of readAll()) {
    for (const track of link.tracks) {
      uris.add(track.uri);
    }
  }
  return [...uris];
}
