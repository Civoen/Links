import { getPlaybackState, addToQueue } from "./spotifyApi";
import { findLinkByTrackUri } from "./linkStore";
import { POLL_INTERVAL_MS } from "./config";

// Design rules this engine follows, agreed on before writing any code:
// 1. Scope: only act when the context is a shuffled playlist. If shuffle is
//    off, or the context isn't a playlist, Links stays hands-off — the user
//    has already chosen (or is deliberately playing) that order.
// 2. Forward-only chaining: whatever track is currently playing, if it's
//    part of a link and isn't the last track in it, queue the next one.
//    Links never checks or cares how the current track was reached —
//    shuffle, a manual tap, or Links itself queuing it a moment earlier.
// 3. Never hijack playback: no skipping, no removing from the queue, no
//    forcing a predecessor to play first. Only ever add a track to "up
//    next".
// 4. Idempotent: since this runs on a poll, the same "track X is playing"
//    observation will be seen on many consecutive ticks. Only act once per
//    play-through of a given track.

let pollHandle: ReturnType<typeof setInterval> | null = null;
let lastActionedTrackUri: string | null = null;

async function tick() {
  try {
    const state = await getPlaybackState();

    if (!state.isPlaying || !state.trackUri) {
      lastActionedTrackUri = null;
      return;
    }

    if (state.contextType !== "playlist" || !state.shuffle) {
      // Out of scope by design — don't touch playback here.
      return;
    }

    if (state.trackUri === lastActionedTrackUri) {
      // Already handled this play-through of this track.
      return;
    }

    const match = findLinkByTrackUri(state.trackUri);
    lastActionedTrackUri = state.trackUri;

    if (!match) return;

    const { link, index } = match;
    const isLastInChain = index === link.tracks.length - 1;
    if (isLastInChain) return;

    const next = link.tracks[index + 1];
    await addToQueue(next.uri);
  } catch (err) {
    // Swallow and retry on the next tick — a single failed poll (network
    // blip, expired token mid-refresh, etc.) shouldn't stop the engine.
    console.error("[linkEngine] tick failed:", err);
  }
}

export function startLinkEngine() {
  if (pollHandle) return;
  pollHandle = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopLinkEngine() {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = null;
  lastActionedTrackUri = null;
}
