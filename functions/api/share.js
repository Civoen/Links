// Cloudflare Pages Function — runs at /api/share on the deployed site.
// POST creates a new share (called from the app when someone clicks
// "Share"). Reuses the same CONTENT_KV namespace already bound for the
// admin CMS, just under a "share:" key prefix, so no new Cloudflare
// dashboard setup is needed for this feature.

const SHARE_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days — shared links in a
// chat channel are mostly relevant in the days after posting, and an
// expiry keeps storage bounded indefinitely without manual cleanup.

function generateShareId() {
  // 8 chars of a UUID, stripped of hyphens — short enough for a clean
  // URL, random enough that guessing a real one isn't practical.
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }

  const { title, tracks } = body;

  if (typeof title !== "string" || !title.trim()) {
    return new Response("Missing title", { status: 400 });
  }
  if (!Array.isArray(tracks) || tracks.length < 2) {
    return new Response("A link needs at least two tracks", { status: 400 });
  }
  const validTracks = tracks.every(
    (t) => t && typeof t.uri === "string" && typeof t.name === "string" && typeof t.artist === "string"
  );
  if (!validTracks) {
    return new Response("Invalid track data", { status: 400 });
  }

  // Only the fields actually needed for the share page and the import
  // flow — deliberately not storing anything beyond what's already
  // visible in a normal Links share (no user identity, no account info).
  const sanitizedTracks = tracks.map((t) => ({
    uri: t.uri,
    name: t.name,
    artist: t.artist,
    album: typeof t.album === "string" ? t.album : undefined,
    albumArt: typeof t.albumArt === "string" ? t.albumArt : undefined,
    durationMs: typeof t.durationMs === "number" ? t.durationMs : undefined
  }));

  const id = generateShareId();
  await context.env.CONTENT_KV.put(
    `share:${id}`,
    JSON.stringify({ title: title.trim(), tracks: sanitizedTracks, createdAt: Date.now() }),
    { expirationTtl: SHARE_TTL_SECONDS }
  );

  return Response.json({ ok: true, id });
}

export async function onRequestGet(context) {
  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const stored = await context.env.CONTENT_KV.get(`share:${id}`, "json");
  if (!stored) return new Response("Not found", { status: 404 });

  return Response.json(stored);
}
