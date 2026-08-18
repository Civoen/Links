// Cloudflare Pages Function — runs at /api/content on the deployed site.
// GET is public (the landing page reads content on every load).
// POST requires the ADMIN_PASSWORD secret (set in Cloudflare's dashboard,
// never committed to the repo) and writes the new content to KV.

const CONTENT_KEY = "site-content";

const DEFAULT_CONTENT = {
  heroSubtext:
    "Links keeps multi-part tracks and sequences you choose playing in order, even when Spotify is on shuffle.",
  tracks: [
    { title: "Pain Remains I: Dancing Like Flames", artist: "Lorna Shore", coverUrl: "" },
    { title: "Pain Remains II: After All I've Done, I'll Disappear", artist: "Lorna Shore", coverUrl: "" }
  ]
};

export async function onRequestGet(context) {
  try {
    const stored = await context.env.CONTENT_KV.get(CONTENT_KEY, "json");
    return Response.json(stored ?? DEFAULT_CONTENT);
  } catch {
    // KV not bound yet, or empty — fall back rather than error, so the
    // public site never breaks because of an admin-side setup gap.
    return Response.json(DEFAULT_CONTENT);
  }
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }

  const { password, content, verifyOnly } = body;

  if (!context.env.ADMIN_PASSWORD || password !== context.env.ADMIN_PASSWORD) {
    // Deliberately generic — don't reveal whether the password was close,
    // or whether ADMIN_PASSWORD is even configured.
    return new Response("Unauthorized", { status: 401 });
  }

  if (verifyOnly) {
    return Response.json({ ok: true });
  }

  if (!content || typeof content !== "object") {
    return new Response("Invalid content", { status: 400 });
  }

  await context.env.CONTENT_KV.put(CONTENT_KEY, JSON.stringify(content));
  return Response.json({ ok: true });
}
