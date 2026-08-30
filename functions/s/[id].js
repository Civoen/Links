// Cloudflare Pages Function — runs at /s/:id on the deployed site. This
// is the actual URL someone pastes into Discord. Serves an HTML page
// with OpenGraph tags (so Discord/Slack/etc. generate a rich preview)
// and, for a human who actually opens it in a browser, a landing page
// with a button that hands off to the desktop app via the same
// links:// protocol handler already used for the Spotify OAuth
// callback.

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPage({ title, tracks, id, notFound }) {
  if (notFound) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Link not found &middot; Links</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="background:#0b0b0b;color:#eee;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px;">
  <div>
    <p style="font-size:18px;font-weight:600;margin:0 0 8px;">This shared link has expired or doesn't exist.</p>
    <p style="color:#999;font-size:14px;">Shared links stick around for 90 days after they're created.</p>
  </div>
</body>
</html>`;
  }

  const trackNames = tracks.map((t) => escapeHtml(t.name)).join("  \u{1F517}  ");
  const description = `${tracks.map((t) => t.name).join(" \u2192 ")} \u2014 open in Links to add this chain to your own queue.`;
  const coverUrl = tracks.find((t) => t.albumArt)?.albumArt || "";
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${safeTitle} &middot; Links</title>
<meta property="og:title" content="${safeTitle}" />
<meta property="og:description" content="${safeDescription}" />
${coverUrl ? `<meta property="og:image" content="${escapeHtml(coverUrl)}" />` : ""}
<meta property="og:site_name" content="Links" />
<meta name="theme-color" content="#1DB954" />
<style>
  body { background: #0b0b0b; color: #eee; font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
  .card { max-width: 420px; width: 100%; background: #161616; border: 1px solid #262626; border-radius: 16px; padding: 28px 24px; text-align: center; }
  .cover { width: 96px; height: 96px; border-radius: 14px; object-fit: cover; margin: 0 auto 18px; display: block; background: #262626; }
  .eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #3ec96a; margin: 0 0 10px; }
  h1 { font-size: 19px; margin: 0 0 10px; }
  .tracks { color: #aaa; font-size: 13.5px; line-height: 1.6; margin: 0 0 24px; }
  .btn { display: block; text-decoration: none; border-radius: 24px; padding: 12px 20px; font-size: 14px; font-weight: 700; margin-bottom: 10px; }
  .btn-primary { background: linear-gradient(135deg, #22d97a, #12833f); color: #04342c; }
  .btn-secondary { background: transparent; border: 1px solid #333; color: #ccc; }
</style>
</head>
<body>
  <div class="card">
    <p class="eyebrow">Shared via Links</p>
    ${coverUrl ? `<img class="cover" src="${escapeHtml(coverUrl)}" alt="" />` : ""}
    <h1>${safeTitle}</h1>
    <p class="tracks">${trackNames}</p>
    <a class="btn btn-primary" href="links://import?id=${encodeURIComponent(id)}">Open in Links</a>
    <a class="btn btn-secondary" href="https://linksapp.uk">Don't have Links? Get it here</a>
  </div>
</body>
</html>`;
}

export async function onRequestGet(context) {
  const id = context.params.id;
  const stored = id ? await context.env.CONTENT_KV.get(`share:${id}`, "json") : null;

  const html = stored
    ? renderPage({ title: stored.title, tracks: stored.tracks, id })
    : renderPage({ notFound: true });

  return new Response(html, {
    status: stored ? 200 : 404,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}
