import { getValidAccessToken } from "./spotifyAuth";

export interface TrackSummary {
  uri: string;
  name: string;
  artist: string;
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

  // 202/204 are normal "accepted, no body" responses from several player
  // endpoints — callers should not assume a JSON body on those.
  return res;
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
    artist: t.artists.map((a: any) => a.name).join(", ")
  }));
}

export async function getPlaybackState(): Promise<PlaybackState> {
  const res = await spotifyFetch("/me/player");

  // 204 means "no active device" — treat as simply not playing.
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

/**
 * Adds a track to play next. Per Spotify's own docs, "the order of
 * execution is not guaranteed" relative to other player calls, so the link
 * engine treats this as best-effort and re-checks on the next poll rather
 * than assuming it landed instantly.
 */
export async function addToQueue(trackUri: string): Promise<void> {
  const params = new URLSearchParams({ uri: trackUri });
  const res = await spotifyFetch(`/me/player/queue?${params.toString()}`, { method: "POST" });

  if (!res.ok && res.status !== 202 && res.status !== 204) {
    throw new Error(`Add to queue failed: ${res.status}`);
  }
}
