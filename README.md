# Links

A Spotify companion desktop app. Links tracks (e.g. "Part 1" and "Part 2")
together so they always play consecutively, even when Spotify is on
shuffle — without ever removing, reordering, or skipping anything Spotify
is already doing.

## How it works

Links is an Electron + React app that talks to the Spotify Web API. There's
no way to hook into Spotify's own client, so Links runs as its own window
and controls playback remotely over Spotify Connect — the same mechanism
Spotify's own apps use to control a speaker or another device.

A background loop (`electron/linkEngine.ts`) polls what's currently playing
every few seconds. If the current track is part of a link, isn't the last
track in it, and the user is on a shuffled playlist, Links adds the next
track in the chain to "up next." That's the entire enforcement mechanism —
by design, Links never skips, removes from the queue, or hijacks playback,
because the Spotify Web API doesn't offer a queue-removal or reorder
endpoint to build any of that on top of.

## Setup: bring your own Spotify Client ID

Links doesn't ship with a Spotify Client ID baked in. Spotify's Development
Mode caps a single Client ID at 5 authenticated users, and the tier without
that cap (Extended Quota Mode) is now only granted to registered
businesses with 250k+ monthly active users — out of reach for an indie
launch. The workaround, and the one most community Spotify tools use: each
user creates their own free Spotify app and is the only user of it, so
nobody hits Spotify's per-app cap.

This happens inside the app itself now, on first launch — Links walks the
user through it (open the Spotify Developer dashboard, create an app, add
`links://callback` as a Redirect URI, paste in the Client ID). Nothing to
configure before building.

You'll still need a Spotify Premium account yourself to actually control
playback — that's a Web API requirement, not something Links can work
around.

## Running it

```
npm install
npm run dev
```

This starts the Vite dev server for the React UI and launches the Electron
window pointed at it. Sign in via "Connect with Spotify" — it opens your
system browser, and the OAuth redirect is caught by the app's registered
`links://` protocol handler.

## Project layout

```
electron/
  main.ts         window creation, protocol handling, IPC wiring, auto-update check
  preload.ts       the only bridge between renderer and main (contextIsolation is on)
  spotifyAuth.ts    PKCE OAuth flow, token storage and refresh
  spotifyApi.ts     search / playback-state / add-to-queue calls
  settings.ts       per-user Spotify Client ID, stored locally
  linkStore.ts      local JSON persistence for created links
  linkEngine.ts     the polling loop that keeps chains together
src/
  App.tsx           routes between Connect / Links / Create link
  pages/            the three screens (Connect now includes the Client ID setup step)
  components/       TrackSearch, shared across screens
```

Updates ship through the same GitHub Releases pipeline used for
distribution: `electron-updater` checks that feed on launch and prompts to
install anything newer, so cutting a new tagged release is also how you
push an update to everyone already running the app.

## Distribution: GitHub builds it, Cloudflare Pages advertises it

Links is a downloaded desktop app, not a website — Cloudflare Pages can't
host or run it directly. The split used here:

- **GitHub Actions** (`.github/workflows/release.yml`) builds a Windows,
  macOS, and Linux installer with `electron-builder` and attaches them to
  a GitHub Release whenever you push a version tag:
  ```
  git tag v0.1.0
  git push origin v0.1.0
  ```
- **`site/`** is a plain static landing page — no build step — with
  download buttons pointing at `github.com/<you>/<repo>/releases/latest`
  (that URL always redirects to the newest release, so it never needs
  updating). Point a Cloudflare Pages project at this repo with the build
  output directory set to `site` and no build command, and it deploys as
  the marketing/download site.

Before your first tagged release, replace `YOUR_GITHUB_USERNAME` in
`site/index.html` with your actual GitHub username or org.

## Icon

`build/icon-source.svg` is the master — the same link glyph used
throughout the UI, rendered into `icon.icns` (macOS), `icon.ico`
(Windows), and `icon.png` (Linux). `electron-builder` picks these up
automatically via the `icon` field in `package.json`'s `build` config.
Regenerating them after a design change: edit the SVG, then re-render at
each required size (see git history for the original render script, built
with `cairosvg` + `Pillow` + `icnsutil`).

## Code signing

Currently unsigned — installers work, but macOS Gatekeeper and Windows
SmartScreen will warn on first open. The release workflow already reads
`CSC_LINK` / `CSC_KEY_PASSWORD` (both platforms) and `APPLE_ID` /
`APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` (macOS notarization) as
environment variables — `electron-builder` picks them up automatically
when present and silently skips signing when they're not, so nothing
about today's builds breaks by their absence.

To turn signing on:

1. **Windows**: buy a code signing certificate from a CA (DigiCert,
   SSL.com, etc). Add its contents as the `CSC_LINK` repo secret (base64
   or file URL, per electron-builder's docs) and its password as
   `CSC_KEY_PASSWORD`.
2. **macOS**: enroll in the Apple Developer Program, generate a
   "Developer ID Application" certificate for `CSC_LINK`/
   `CSC_KEY_PASSWORD`, and set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
   and `APPLE_TEAM_ID` for notarization.
3. Add all of these under repo **Settings → Secrets and variables →
   Actions**. The next tagged release picks them up with no workflow
   changes needed.

## Known gaps to close before a real release

- **Token storage is plaintext.** Swap `fs.writeFileSync` in
  `spotifyAuth.ts` for Electron's `safeStorage` API to encrypt tokens at
  rest.
- **No retry/backoff on the poll loop** beyond "try again next tick" —
  fine for an MVP, worth tightening before wider use.
- **Single Electron window only.** Mobile (iOS/Android) will need its own
  shell, but `electron/spotifyAuth.ts`, `spotifyApi.ts`, `linkStore.ts`,
  and `linkEngine.ts` have no Electron-specific dependencies beyond
  `app.getPath` for file storage — that's the logic to carry over.

Note on versioning: don't hand-edit `"version"` in `package.json` before
tagging a release — the workflow's "Set version from tag" step derives it
automatically from whatever tag you push (`v0.1.4` → `0.1.4`), so the two
can't drift out of sync with each other.
