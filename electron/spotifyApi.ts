import { getValidAccessToken } from "./spotifyAuth";

export interface TrackSummary {
  uri: string;
  name: string;
  artist: string;
  album?: string;
  albumArt?: string; // small (~64px) album art URL, when Spotify provides one
  durationMs?: number;
  albumUri?: string; // used to group tracks by album for link suggestions
  trackNumber?: number; // used to detect sequential tracks for link suggestions
}

export interface PlaybackState {
  isPlaying: boolean;
  trackUri: string | null;
  contextType: string | null; // "playlist" | "album" | "artist" | null
  shuffle: boolean;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  trackCount: number;
}

async function spotifyFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not connected to Spotify");

  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`
    }
  });

  return res;
}

/** For paginated endpoints — Spotify's "next" field is already a full URL. */
async function spotifyFetchFullUrl(url: string): Promise<Response> {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not connected to Spotify");

  return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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

export async function getPlaybackState(): Promise<PlaybackState> {
  const res = await spotifyFetch("/me/player");

  if (res.status === 204 || !res.ok) {
    return { isPlaying: false, trackUri: null, contextType: null, shuffle: false };
  }

  const json = await res.json();
  return {
    isPlaying: Boolean(json.is_playing),
    trackUri: json.item?.uri ?? null,
    contextType: json.context?.type ?? null,
    shuffle: Boolean(json.shuffle_state)
  };
}

export async function addToQueue(trackUri: string): Promise<void> {
  const params = new URLSearchParams({ uri: trackUri });
  const res = await spotifyFetch(`/me/player/queue?${params.toString()}`, { method: "POST" });

  if (!res.ok && res.status !== 202 && res.status !== 204) {
    throw new Error(`Add to queue failed: ${res.status}`);
  }
}

/**
 * Returns the URIs of upcoming tracks, in order. Spotify's queue endpoint
 * has documented reliability quirks — it can return stale or inconsistent
 * results depending on shuffle state — so callers should treat this as a
 * best-effort signal, not ground truth, and re-check rather than trust a
 * single read.
 */
export async function getQueue(): Promise<string[]> {
  const res = await spotifyFetch("/me/player/queue");
  if (!res.ok) return [];

  const json = await res.json();
  const items = Array.isArray(json.queue) ? json.queue : [];
  return items.map((t: any) => t.uri).filter(Boolean);
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

/** The current user's playlists (owned or followed), one page of up to 50. */
export async function getUserPlaylists(): Promise<PlaylistSummary[]> {
  const res = await spotifyFetch("/me/playlists?limit=50");
  if (!res.ok) return [];

  const json = await res.json();
  return json.items.map((p: any) => ({
    id: p.id,
    name: p.name,
    trackCount: p.tracks?.total ?? 0
  }));
}

/** Every track in a playlist, following pagination for playlists over 100 tracks. */
export async function getPlaylistTracks(playlistId: string): Promise<TrackSummary[]> {
  const fields = "next,items(track(uri,name,artists,album(name,uri,images),duration_ms,track_number))";
  let url: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=${encodeURIComponent(fields)}`;
  const results: TrackSummary[] = [];

  while (url) {
    const res = await spotifyFetchFullUrl(url);
    if (!res.ok) break;

    const json = await res.json();
    for (const item of json.items ?? []) {
      if (item?.track) results.push(trackFromApi(item.track));
    }

    url = json.next ?? null;
  }

  return results;
}
