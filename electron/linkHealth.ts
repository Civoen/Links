import { getTracksByUri } from "./spotifyApi";
import { getAllTrackUris } from "./linkStore";

// A track is a null entry in Spotify's batch response when it's been
// fully removed/delisted. This deliberately does NOT try to distinguish
// "removed everywhere" from "restricted in your market" — Spotify's batch
// endpoint doesn't reliably expose per-track playability without extra
// per-track calls, and the common case worth catching (a track that's
// truly gone) is what a null entry actually means.
//
// Just as important: a track is ONLY ever flagged broken if we got a
// successful response that confirmed it missing. A failed request (rate
// limit, network blip) means "unknown", not "broken" — conflating the two
// was the exact bug that flagged perfectly playable tracks.
export async function findBrokenTrackUris(): Promise<Set<string>> {
  const allUris = getAllTrackUris();
  if (allUris.length === 0) return new Set();

  try {
    const { found, inconclusiveIds } = await getTracksByUri(allUris);
    const foundUris = new Set(found.map((t) => t.uri));
    const inconclusive = new Set(inconclusiveIds);

    const broken = allUris.filter((uri) => {
      if (foundUris.has(uri)) return false;
      const bareId = uri.split(":").pop();
      if (bareId && inconclusive.has(bareId)) return false; // unknown status — don't flag
      return true; // confirmed absent from a successful response
    });

    return new Set(broken);
  } catch (err) {
    console.error("[linkHealth] broken-track check failed:", err);
    return new Set();
  }
}
