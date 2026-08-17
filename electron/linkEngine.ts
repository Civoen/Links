import { getPlaybackState, addToQueue, getQueue } from "./spotifyApi";
import { findLinkByTrackUri, getLinks } from "./linkStore";
import { POLL_INTERVAL_MS } from "./config";

// Design rules this engine follows:
// 1. Forward-only chaining: whatever track is currently playing, if it's
//    part of a link and isn't the last track in it, queue the next one.
//    Links never checks or cares how the current track was reached —
//    shuffle, a manual tap from search, an album, Liked Songs, or Links
//    itself queuing it a moment earlier.
// 2. Out-of-order correction (best-effort): if a later track in a chain is
//    sitting in the upcoming queue before its predecessor has played,
//    Links queues the predecessor so it plays first. This only works
//    *before* the later track starts playing — once something's actually
//    playing, nothing can un-play it, and Links won't skip backward to
//    force a redo. It also depends on Spotify's queue-reading endpoint,
//    which is documented as sometimes returning stale or inconsistent
//    results, so this is a best-effort improvement, not a guarantee.
// 3. Never hijack playback: no skipping, no removing from the queue, no
//    forcing a predecessor to play first by interrupting what's already
//    playing. Only ever add a track to "up next".
// 4. Idempotent: since this runs on a poll, the same observation will be
//    seen on many consecutive ticks. Only act once per situation, not
//    once per tick.

let pollHandle: ReturnType<typeof setInterval> | null = null;
let lastActionedTrackUri: string | null = null;

// Tracks which (linkId, index) out-of-order corrections have already been
// made, so a lingering "successor still in queue" observation across many
// poll ticks doesn't trigger repeat inserts of the same predecessor.
const handledCorrections = new Set<string>();

async function tick() {
  try {
    const state = await getPlaybackState();

    if (!state.isPlaying || !state.trackUri) {
      lastActionedTrackUri = null;
      return;
    }

    if (state.trackUri !== lastActionedTrackUri) {
      lastActionedTrackUri = state.trackUri;
      await handleForwardChaining(state.trackUri);
    }

    await handleOutOfOrderCorrection(state.trackUri);
  } catch (err) {
    // Swallow and retry on the next tick — a single failed poll (network
    // blip, expired token mid-refresh, etc.) shouldn't stop the engine.
    console.error("[linkEngine] tick failed:", err);
  }
}

/** Rule 1: queue the next track in a chain once its predecessor starts playing. */
async function handleForwardChaining(currentTrackUri: string) {
  const match = findLinkByTrackUri(currentTrackUri);
  if (!match) return;

  const { link, index } = match;
  const isLastInChain = index === link.tracks.length - 1;
  if (isLastInChain) return;

  const next = link.tracks[index + 1];
  await addToQueue(next.uri);
}

/** Rule 2: catch a successor sitting in the queue ahead of its predecessor. */
async function handleOutOfOrderCorrection(currentTrackUri: string) {
  const links = getLinks();
  if (links.length === 0) return;

  const queueUris = await getQueue();
  if (queueUris.length === 0) return;

  for (const link of links) {
    for (let i = 1; i < link.tracks.length; i++) {
      const predecessor = link.tracks[i - 1];
      const successor = link.tracks[i];
      const correctionKey = `${link.id}:${i}`;

      const successorIsUpcoming = queueUris.includes(successor.uri);
      if (!successorIsUpcoming) {
        // Nothing to fix right now — clear any stale record so a future
        // occurrence of this same situation can be handled fresh.
        handledCorrections.delete(correctionKey);
        continue;
      }

      const predecessorAlreadyInPlace =
        predecessor.uri === currentTrackUri || queueUris.includes(predecessor.uri);

      if (predecessorAlreadyInPlace) {
        // Either the predecessor is playing right now, or it's already
        // queued too (most likely because Links itself put it there via
        // forward chaining) — nothing out of order here.
        continue;
      }

      if (handledCorrections.has(correctionKey)) {
        // Already inserted the predecessor for this occurrence; waiting
        // for it to actually play rather than inserting it repeatedly.
        continue;
      }

      handledCorrections.add(correctionKey);
      await addToQueue(predecessor.uri);
    }
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
  handledCorrections.clear();
}
