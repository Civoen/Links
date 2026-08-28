# Links

Keep the tracks you choose playing in order, even when Spotify is on shuffle.

## The problem

Multi-part songs and sequences, a "Part 1" and "Part 2," a suite, a rock
opera in three movements, only play in the right order if you listen to
the whole album straight through. The moment shuffle is on anywhere in
your rotation, those parts get scattered. You might hear Part 2 an hour
before Part 1, or never hear them back to back at all.

Turning shuffle off just to protect a handful of songs means losing it
for everything else too.

## What Links does

Links is a small companion app that runs alongside Spotify. You tell it
once which tracks belong together, in what order. From then on, whenever
the first track in that sequence plays, Links quietly adds the rest to
your queue, right away, in the right order. Everything else keeps
shuffling exactly as normal.

Links never skips, removes, or reorders anything Spotify is already
doing. It only ever adds to your queue, the one thing Spotify's API
actually allows a companion app to do, so it can't interrupt playback or
fight with Spotify itself.

## How it works

1. **Create a link.** Search for the tracks that belong together, in the
   order you want them to play.
2. **Keep shuffle on.** Listen exactly like you normally do.
3. **Links takes care of the rest.** The moment the first track starts
   playing, from anywhere, the rest of the chain gets queued right after
   it.

## A few other things it does

- **Health page.** See at a glance whether each link is actually
  working, with plain explanations if something's off, not silence.
- **Desktop notifications.** Since Links is meant to run quietly in the
  background, it can tell you what it's doing without needing the window
  open.
- **Import and export.** Back up your links, or move them to another
  device.
- Runs from the system tray, with an option to launch straight there.

## Install

**Spotify Premium is required.** That's a limitation of Spotify's own
API, not something Links can work around.

### Windows

1. Download `Links-Setup.exe` from the
   [latest release](https://github.com/Civoen/Links/releases/latest).
2. Windows will show a caution screen. That's because Links isn't
   code-signed (a signing certificate costs money to maintain, and this
   is a free, independent project), not a sign anything's wrong. Click
   **More info**, then **Run anyway**. You'll only see this once.
3. Open Links and follow the one-time setup to connect your Spotify
   account.

### Linux

1. Download `Links.AppImage` from the
   [latest release](https://github.com/Civoen/Links/releases/latest).
2. Mark it executable, then run it:
   ```
   chmod +x Links-*.AppImage
   ./Links-*.AppImage
   ```
   Or right-click the file, Properties, Permissions, and allow executing,
   if you'd rather not use a terminal. This is a standard step for any
   AppImage, not specific to Links.

### macOS

Not currently supported. Apple's code-signing requirements mean an
unsigned Mac app doesn't just get a warning, it gets deleted
automatically on first launch. Support may return if signing becomes
affordable.

## First-time setup

The first time you open Links, it walks you through connecting your own
free Spotify developer app. That's a one-time step Spotify requires of
every app like this, not something specific to Links, and it only takes
a couple of minutes. The app guides you through it directly.

## Disclaimer

Links is an independent, unofficial project. It is not affiliated with,
endorsed by, or sponsored by Spotify AB. Spotify is a trademark of
Spotify AB.

---

Looking to build or contribute to Links? See [DEVELOPMENT.md](DEVELOPMENT.md).
