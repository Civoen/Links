// Each user brings their own Spotify Client ID rather than Links shipping
// with one baked in. That's not a stylistic choice — Spotify's Development
// Mode caps a single Client ID at 5 authenticated users, and Extended Quota
// Mode (the tier without that cap) is now only granted to registered
// businesses with 250k+ monthly active users. Since every user creates
// their own free Spotify app and is the sole user of it, nobody hits that
// ceiling. See electron/settings.ts for where the ID is actually stored.

export const REDIRECT_URI = "links://callback";

export const SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative"
].join(" ");

// How often the link engine checks what's currently playing. Spotify's Web
// API has no push/webhook layer, so this poll is the only way to notice a
// linked track has started. Kept short since the window between "track
// starts" and "successor should be queued" is where reliability is won or
// lost.
export const POLL_INTERVAL_MS = 3000;

