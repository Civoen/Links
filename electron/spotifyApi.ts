import { getValidAccessToken } from "./spotifyAuth";

export interface TrackSummary {
  uri: string;
  name: string;
  artist: string;
  album?: string;
  albumArt?: string; // small (~64px) album art URL, when Spotify provides one
  durationMs?: number;
}

export interface PlaybackState {
  isPlaying: boolean;
  trackUri: string | null;
  contextType: string | null; // "playlist" | "album" | "artist" | null
  shuffle: boolean;
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

/** Picks the smallest album image Spotify offers — plenty for a list-row thumbnail. */
function smallestImage(images: any[] | undefined): string | undefined {
  if (!images || images.length === 0) return undefined;
  return [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0]?.url;
}

export async function searchTracks(query: string): Promise<TrackSummary[]> {
  if (!query.trim()) return [];

  const params = new URLSearchParams({ q: query, type: "track", limit: "10" });
  const res = await spotifyFetch(`/search?${params.toString()}`);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);

  const json = await res.json();
  return json.tracks.items.map((t: any) => ({
    uri: t.uri,
    name: t.name,
    artist: t.artists.map((a: any) => a.name).join(", "),
    album: t.album?.name,
    albumArt: smallestImage(t.album?.images),
    durationMs: t.duration_ms
  }));
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
