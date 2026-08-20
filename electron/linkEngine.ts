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
//
// Two rounds of real-world bug reports shaped this file:
//
// Round 1 (duplicate adds): neither Spotify's playback-state nor its
// queue-read endpoint are fully reliable single-poll signals. Every
// "have I already handled this" check requires *confirmed* state, not a
// single read, so one flaky poll can't cause a duplicate add.
//
// Round 2 (randomly missed adds): the state that marks something as
// "handled" was being set *before* the action that does the actual work,
// not after. If that action threw for any reason (network blip, a slow
// response, a rate limit), the exception was caught and logged, but the
// track was already marked handled — so the engine silently gave up and
// never retried it. Every "mark as handled" step below now happens only
// after the corresponding action has actually completed.

let pollHandle: ReturnType<typeof setInterval> | null = null;
let lastActionedTrackUri: string | null = null;
const handledCorrections = new Set<string>();

const STOPPED_CONFIRMATION_TICKS = 2;
let consecutiveNotPlayingTicks = 0;

// Prevents two tick() calls from running at once. A single tick can make
// up to four sequential API calls; under real-world latency that can
// exceed POLL_INTERVAL_MS, and setInterval doesn't wait for the previous
// call to finish before firing the next one. Two overlapping ticks
// reading and writing the same shared state is exactly the kind of thing
// that produces intermittent, hard-to-reproduce bugs.
let tickInProgress = false;

let onAction: ((message: string) => void) | null = null;

async function tick() {
  if (tickInProgress) return;
  tickInProgress = true;

  try {
    const state = await getPlaybackState();

    if (!state.isPlaying || !state.trackUri) {
      consecutiveNotPlayingTicks++;
      if (consecutiveNotPlayingTicks >= STOPPED_CONFIRMATION_TICKS) {
        lastActionedTrackUri = null;
      }
      return;
    }
    consecutiveNotPlayingTicks = 0;

    if (state.trackUri !== lastActionedTrackUri) {
      // Only commit to "handled" after this actually completes without
      // throwing — if it fails partway through, state.trackUri is still
      // != lastActionedTrackUri on the next tick, so it gets retried
      // instead of silently skipped forever.
      await handleForwardChaining(state.trackUri);
      lastActionedTrackUri = state.trackUri;
    }

    await handleOutOfOrderCorrection(state.trackUri);
  } catch (err) {
    console.error("[linkEngine] tick failed:", err);
  } finally {
    tickInProgress = false;
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

  const queueUris = await getQueue();
  if (queueUris.includes(next.uri)) return;

  await addToQueue(next.uri);
  onAction?.(`Queued "${next.name}" next`);
}

async function handleOutOfOrderCorrection(currentTrackUri: string) {
  const links = getLinks();
  if (links.length === 0) return;

  const queueUris = await getQueue();

  for (const link of links) {
    if (!link.active) continue;
    for (let i = 1; i < link.tracks.length; i++) {
      const predecessor = link.tracks[i - 1];
      const successor = link.tracks[i];
      const correctionKey = `${link.id}:${i}`;

      if (currentTrackUri === successor.uri) {
        handledCorrections.delete(correctionKey);
        continue;
      }

      if (queueUris.length === 0) continue;

      const successorIsUpcoming = queueUris.includes(successor.uri);
      if (!successorIsUpcoming) continue;

      const predecessorAlreadyInPlace =
        predecessor.uri === currentTrackUri || queueUris.includes(predecessor.uri);

      if (predecessorAlreadyInPlace) continue;
      if (handledCorrections.has(correctionKey)) continue;

      // Mark as handled only after the add actually succeeds — same fix
      // as forward-chaining above. Previously this line ran *before* the
      // await, so a failed add still silently blocked all future retries
      // of this exact correction.
      await addToQueue(predecessor.uri);
      handledCorrections.add(correctionKey);
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
  consecutiveNotPlayingTicks = 0;
  tickInProgress = false;
  handledCorrections.clear();
}
