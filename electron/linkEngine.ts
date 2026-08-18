import { getPlaybackState, addToQueue, getQueue } from "./spotifyApi";
import { findLinkByTrackUri, getLinks } from "./linkStore";
import { POLL_INTERVAL_MS } from "./config";

// Design rules this engine follows:
// 1. Forward-only chaining: whatever track is currently playing, if it's
//    part of a link and isn't the last track in it, queue the next one.
// 2. Out-of-order correction (best-effort): if a later track in a chain is
//    sitting in the upcoming queue before its predecessor has played,
//    Links queues the predecessor so it plays first.
// 3. Never hijack playback: only ever add a track to "up next".
// 4. Idempotent: only act once per situation, not once per tick.

let pollHandle: ReturnType<typeof setInterval> | null = null;
let lastActionedTrackUri: string | null = null;
const handledCorrections = new Set<string>();

// Fires with a short human-readable description whenever the engine
// actually queues something — used to surface a small in-app notification
// rather than the action happening silently.
let onAction: ((message: string) => void) | null = null;

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
    console.error("[linkEngine] tick failed:", err);
  }
}

async function handleForwardChaining(currentTrackUri: string) {
  const match = findLinkByTrackUri(currentTrackUri);
  if (!match) return;
  if (!match.link.active) return;

  const { link, index } = match;
  const isLastInChain = index === link.tracks.length - 1;
  if (isLastInChain) return;

  const next = link.tracks[index + 1];
  await addToQueue(next.uri);
  onAction?.(`Queued "${next.name}" next`);
}

async function handleOutOfOrderCorrection(currentTrackUri: string) {
  const links = getLinks();
  if (links.length === 0) return;

  const queueUris = await getQueue();
  if (queueUris.length === 0) return;

  for (const link of links) {
    if (!link.active) continue;
    for (let i = 1; i < link.tracks.length; i++) {
      const predecessor = link.tracks[i - 1];
      const successor = link.tracks[i];
      const correctionKey = `${link.id}:${i}`;

      const successorIsUpcoming = queueUris.includes(successor.uri);
      if (!successorIsUpcoming) {
        handledCorrections.delete(correctionKey);
        continue;
      }

      const predecessorAlreadyInPlace =
        predecessor.uri === currentTrackUri || queueUris.includes(predecessor.uri);

      if (predecessorAlreadyInPlace) continue;
      if (handledCorrections.has(correctionKey)) continue;

      handledCorrections.add(correctionKey);
      await addToQueue(predecessor.uri);
      onAction?.(`Moved "${predecessor.name}" ahead of "${successor.name}"`);
    }
  }
}

export function startLinkEngine(actionCallback?: (message: string) => void) {
  if (actionCallback) onAction = actionCallback;
  if (pollHandle) return;
  pollHandle = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopLinkEngine() {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = null;
  lastActionedTrackUri = null;
  handledCorrections.clear();
}
