import type { TrackSummary } from "./spotifyApi";

const SHARE_BASE_URL = "https://linksapp.uk";

export interface ShareData {
  title: string;
  tracks: TrackSummary[];
}

export async function createShare(
  title: string,
  tracks: TrackSummary[]
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const res = await fetch(`${SHARE_BASE_URL}/api/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, tracks })
    });

    if (!res.ok) {
      return { ok: false, error: `Couldn't create the share link (${res.status}).` };
    }

    const json = await res.json();
    return { ok: true, url: `${SHARE_BASE_URL}/s/${json.id}` };
  } catch {
    return { ok: false, error: "Couldn't reach linksapp.uk. Check your connection and try again." };
  }
}

/** Called when a links://import?id=... URL comes in, to fetch the actual track data before handing off to Create Link. */
export async function fetchShare(id: string): Promise<ShareData | null> {
  try {
    const res = await fetch(`${SHARE_BASE_URL}/api/share?id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;

    const json = await res.json();
    if (!json || typeof json.title !== "string" || !Array.isArray(json.tracks)) return null;

    return { title: json.title, tracks: json.tracks };
  } catch {
    return null;
  }
}
