import { getValidAccessToken } from "./spotifyAuth";

export interface TrackSummary {
  uri: string;
  name: string;
  artist: string;
  album?: string;
  albumArt?: string; // small (~64px) album art URL, when Spotify provides one
  durationMs?: number;
  albumUri?: string; // used to group tracks by album for sibling detection
  trackNumber?: number; // used to detect sequential tracks for sibling detection
}

export interface PlaybackState {
  isPlaying: boolean;
  trackUri: string | null;
  trackName: string | null;
  trackArtist: string | null;
  trackDurationMs: number | null;
  contextType: string | null; // "playlist" | "album" | "artist" | null
  shuffle: boolean;
}

// When set, spotifyFetch refuses to make further requests until this
// time passes — populated from Spotify's own Retry-After header on a 429
// response, so a rate limit gets genuinely respected instead of being
// hammered again on the next 3-second poll.
let rateLimitedUntil: number | null = null;

export function isRateLimited(): boolean {
  return rateLimitedUntil !== null && Date.now() < rateLimitedUntil;
}

export function getRateLimitRemainingSeconds(): number {
  if (!rateLimitedUntil) return 0;
  return Math.max(0, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
}

async function spotifyFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (isRateLimited()) {
    throw new Error("Spotify has asked Links to slow down temporarily.");
  }

  const token = await getValidAccessToken();
  if (!token) throw new Error("Not connected to Spotify");

  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`
    }
  });

  if (res.status === 429) {
    const retryAfterHeader = res.headers.get("Retry-After");
    const parsed = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;
    const retryAfterSeconds = isNaN(parsed) ? 30 : parsed; // sensible default if Spotify omits the header
    rateLimitedUntil = Date.now() + retryAfterSeconds * 1000;
  } else {
    rateLimitedUntil = null;
  }

  return res;
}

/** Picks the smallest album image Spotify offers — plenty for a list-row thumbnail. */
function smallestImage(images: any[] | undefined): string | undefined {
  if (!images || images.length === 0) return undefined;
  return [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0]?.url;
}

function trackFromApi(t: any): TrackSummary {
  return {
    uri: t.uri,
    name: t.name,
    artist: t.artists.map((a: any) => a.name).join(", "),
    album: t.album?.name,
    albumArt: smallestImage(t.album?.images),
    durationMs: t.duration_ms,
    albumUri: t.album?.uri,
    trackNumber: t.track_number
  };
}

export async function searchTracks(query: string): Promise<TrackSummary[]> {
  if (!query.trim()) return [];

  const params = new URLSearchParams({ q: query, type: "track", limit: "10" });
  const res = await spotifyFetch(`/search?${params.toString()}`);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);

  const json = await res.json();
  return json.tracks.items.map(trackFromApi);
}

export interface ConnectionHealth {
  ok: boolean;
  reason?: "auth" | "network";
}

/**
 * Checks whether the current connection can actually reach Spotify's
 * playback endpoints — not just "does a token exist" (which is all
 * isConnected() confirms), but "does it still actually work." Separate
 * from getPlaybackState deliberately: that function is called every
 * three seconds by the poll loop and currently treats any non-ok
 * response (including a genuine 401/403) the same as "nothing is
 * playing" — correct for the hot path, but it means the poll loop alone
 * has no way to notice a degraded connection. This function exists
 * specifically to notice.
 */
export async function checkConnectionHealth(): Promise<ConnectionHealth> {
  try {
    const res = await spotifyFetch("/me/player");
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "auth" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export async function getPlaybackState(): Promise<PlaybackState> {
  const res = await spotifyFetch("/me/player");

  if (res.status === 204 || !res.ok) {
    return {
      isPlaying: false,
      trackUri: null,
      trackName: null,
      trackArtist: null,
      trackDurationMs: null,
      contextType: null,
      shuffle: false
    };
  }

  const json = await res.json();
  return {
    isPlaying: Boolean(json.is_playing),
    trackUri: json.item?.uri ?? null,
    trackName: json.item?.name ?? null,
    trackArtist: Array.isArray(json.item?.artists)
      ? json.item.artists.map((a: any) => a.name).join(", ")
      : null,
    trackDurationMs: json.item?.duration_ms ?? null,
    contextType: json.context?.type ?? null,
    shuffle: Boolean(json.shuffle_state)
  };
}

/**
 * Thrown specifically when Spotify's response confirms the account lacks
 * Premium — confirmed via the documented structured error body
 * ({"error":{"reason":"PREMIUM_REQUIRED"}}), not just any 403. A 403 can
 * happen for other, transient reasons too, so this is only thrown when
 * Spotify's own response explicitly says which one this is.
 */
export class PremiumRequiredError extends Error {
  constructor() {
    super("Spotify Premium is required to manage playback.");
    this.name = "PremiumRequiredError";
  }
}

export async function addToQueue(trackUri: string): Promise<void> {
  const params = new URLSearchParams({ uri: trackUri });
  const res = await spotifyFetch(`/me/player/queue?${params.toString()}`, { method: "POST" });

  if (!res.ok && res.status !== 202 && res.status !== 204) {
    if (res.status === 403) {
      try {
        const body = await res.clone().json();
        if (body?.error?.reason === "PREMIUM_REQUIRED") {
          throw new PremiumRequiredError();
        }
      } catch (err) {
        if (err instanceof PremiumRequiredError) throw err;
        // Body wasn't parseable JSON — fall through to the generic error below.
      }
    }
    throw new Error(`Add to queue failed: ${res.status}`);
  }
}

export interface QueuedTrack {
  uri: string;
  name: string;
  artist: string;
  durationMs?: number;
}

/**
 * Returns upcoming tracks, in order. Spotify's queue endpoint has
 * documented reliability quirks — it can return stale or inconsistent
 * results depending on shuffle state — so callers should treat this as a
 * best-effort signal, not ground truth, and re-check rather than trust a
 * single read. Returns full track info, not just URIs, so callers that
 * need identity-based matching (a track released under a different
 * Spotify ID than what's stored) have what they need — see
 * findQueuedTrackByIdentity in linkEngine.ts.
 */
export async function getQueue(): Promise<QueuedTrack[]> {
  const res = await spotifyFetch("/me/player/queue");
  if (!res.ok) return [];

  const json = await res.json();
  const items = Array.isArray(json.queue) ? json.queue : [];
  return items
    .filter((t: any) => t?.uri)
    .map((t: any) => ({
      uri: t.uri,
      name: t.name,
      artist: Array.isArray(t.artists) ? t.artists.map((a: any) => a.name).join(", ") : "",
      durationMs: t.duration_ms
    }));
}

/**
 * Batch-fetches track metadata by URI (up to 50 at a time, Spotify's
 * limit). Used to backfill album art/duration for links saved before
 * those fields were tracked — not needed for normal search/playback flow.
 */
export interface TrackLookupResult {
  found: TrackSummary[];
  // IDs whose batch request failed even after a retry — genuinely unknown
  // status, NOT the same as "confirmed missing". Callers must not treat
  // these as broken/removed tracks.
  inconclusiveIds: string[];
}

async function fetchTrackBatch(batch: string[]): Promise<Response> {
  const res = await spotifyFetch(`/tracks?ids=${batch.join(",")}`);
  if (res.ok) return res;

  // One retry — covers the common transient case (a momentary rate limit
  // or network blip) rather than immediately giving up on an entire batch
  // of up to 50 tracks.
  await new Promise((resolve) => setTimeout(resolve, 500));
  return spotifyFetch(`/tracks?ids=${batch.join(",")}`);
}

export async function getTracksByUri(uris: string[]): Promise<TrackLookupResult> {
  if (uris.length === 0) return { found: [], inconclusiveIds: [] };

  const ids = uris.map((uri) => uri.split(":").pop()).filter(Boolean) as string[];
  const found: TrackSummary[] = [];
  const inconclusiveIds: string[] = [];

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const res = await fetchTrackBatch(batch);

    if (!res.ok) {
      // Still failing after the retry — we genuinely don't know the
      // status of these tracks. Record them as inconclusive rather than
      // silently dropping them, so callers can avoid flagging them broken.
      inconclusiveIds.push(...batch);
      continue;
    }

    const json = await res.json();
    for (const t of json.tracks ?? []) {
      if (t) found.push(trackFromApi(t));
    }
  }

  return { found, inconclusiveIds };
}

/**
 * Every track on an album, used to find sibling parts of a multi-part
 * song when building a link — e.g. adding "Pain Remains I" looks up its
 * album directly to find "Pain Remains II" sitting right next to it,
 * rather than requiring a playlist scan to happen to contain both.
 * "Get Album Tracks" is confirmed current in Spotify's API reference,
 * distinct from "Get Several Albums" (removed in the February 2026
 * migration) — this is the single-album endpoint, not the batch one.
 */
export async function getAlbumTracks(albumUri: string): Promise<TrackSummary[]> {
  const albumId = albumUri.split(":").pop();
  if (!albumId) return [];

  // The tracks endpoint alone doesn't include album art or the album name
  // (redundant to repeat per-track when already scoped to one album), so
  // fetch the album's own info in parallel rather than leaving any
  // sibling track permanently missing a cover once it's saved to a link.
  const [albumRes, tracksRes] = await Promise.all([
    spotifyFetch(`/albums/${albumId}`),
    spotifyFetch(`/albums/${albumId}/tracks?limit=50`)
  ]);

  if (!tracksRes.ok) return [];

  let albumName: string | undefined;
  let albumArt: string | undefined;
  if (albumRes.ok) {
    const albumJson = await albumRes.json();
    albumName = albumJson.name;
    albumArt = smallestImage(albumJson.images);
  }

  const json = await tracksRes.json();
  const items = Array.isArray(json.items) ? json.items : [];

  return items.map((t: any) => ({
    uri: t.uri,
    name: t.name,
    artist: t.artists.map((a: any) => a.name).join(", "),
    album: albumName,
    albumArt,
    albumUri,
    durationMs: t.duration_ms,
    trackNumber: t.track_number
  }));
}
