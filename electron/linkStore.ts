import { app } from "electron";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { TrackSummary } from "./spotifyApi";

export interface Link {
  id: string;
  tracks: TrackSummary[]; // ordered: tracks[0] must precede tracks[1], etc.
  createdAt: number;
}

const STORE_PATH = () => path.join(app.getPath("userData"), "links.json");

function readAll(): Link[] {
  try {
    const raw = fs.readFileSync(STORE_PATH(), "utf-8");
    return JSON.parse(raw) as Link[];
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

export function saveLink(tracks: TrackSummary[]): Link {
  if (tracks.length < 2) {
    throw new Error("A link needs at least two tracks");
  }

  const link: Link = {
    id: crypto.randomUUID(),
    tracks,
    createdAt: Date.now()
  };

  const links = readAll();
  links.push(link);
  writeAll(links);
  return link;
}

export function updateLink(id: string, tracks: TrackSummary[]): void {
  if (tracks.length < 2) {
    throw new Error("A link needs at least two tracks");
  }

  const links = readAll();
  const index = links.findIndex((l) => l.id === id);
  if (index === -1) throw new Error("Link not found");

  links[index] = { ...links[index], tracks };
  writeAll(links);
}

export function deleteLink(id: string): void {
  writeAll(readAll().filter((l) => l.id !== id));
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
