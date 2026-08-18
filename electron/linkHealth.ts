import { getTracksByUri } from "./spotifyApi";
import { getAllTrackUris } from "./linkStore";

// A track is a null entry in Spotify's batch response when it's been
// fully removed/delisted. This deliberately does NOT try to distinguish
// "removed everywhere" from "restricted in your market" — Spotify's batch
// endpoint doesn't reliably expose per-track playability without extra
// per-track calls, and the common case worth catching (a track that's
// truly gone) is what a null entry actually means.
export async function findBrokenTrackUris(): Promise<Set<string>> {
  const allUris = getAllTrackUris();
  if (allUris.length === 0) return new Set();

  try {
    const found = await getTracksByUri(allUris);
    const foundUris = new Set(found.map((t) => t.uri));
    const broken = allUris.filter((uri) => !foundUris.has(uri));
    return new Set(broken);
  } catch (err) {
    console.error("[linkHealth] broken-track check failed:", err);
    return new Set();
  }
}
