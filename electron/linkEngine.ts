import { getPlaybackState, addToQueue, getQueue } from "./spotifyApi";
import { findLinkByTrackUri, getLinks } from "./linkStore";
import { POLL_INTERVAL_MS } from "./config";

// Design rules this engine follows:
// 1. Forward chaining: whatever track is currently playing, if it's part
//    of a link, queue every remaining track in that link right away — not
//    just the immediate next one. See "Round 3" below for why.
// 2. Out-of-order correction (best-effort): if a later track in a chain is
//    sitting in the upcoming queue before its predecessor has played,
//    Links queues the predecessor so it plays first.
// 3. Never hijack playback: only ever add a track to "up next".
// 4. Idempotent: only act once per situation, not once per tick.
//
// Three rounds of real-world bug reports shaped this file:
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
//
// Round 3 (chain broken by a manual queue addition): with a 3+ track
// chain, queuing only one step ahead left a real gap — if someone
// manually added a track to their queue while an early chain member was
// playing, it could land ahead of a later chain member that Links hadn't
// queued yet, since Links was still waiting for that member's own
// predecessor to start playing first. Queuing the whole remaining chain
// the moment the first track starts closes that gap, at the cost of
// committing to the rest of the chain earlier than strictly necessary.

// Round 4 (a track re-added after already being played): correction had
// no memory of what had already played in this session. If a predecessor
// legitimately played earlier and the listener simply moved on (by
// skipping, or because Spotify's shuffle context served something else
// next instead of the queued successor), correction saw "successor is
// upcoming, predecessor isn't here right now" and concluded the link had
// been broken — re-queuing a track that had already had its turn. Worse,
// that re-add then made the *next* pair back look broken too, cascading
// backward through the whole chain. Correction now tracks the furthest
// position reached in each link and never tries to "fix" a pair whose
// predecessor position has already been reached.

let pollHandle: ReturnType<typeof setInterval> | null = null;
let lastActionedTrackUri: string | null = null;
const handledCorrections = new Set<string>();

// The highest track index reached in each link during this run of the
// app — not persisted, and (deliberately, for simplicity) never reset
// mid-session, so replaying a link from the start later in the same
// session won't re-enable correction for positions already passed once.
const furthestIndexReached = new Map<string, number>();

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

  const { link, index } = match;

  const previousFurthest = furthestIndexReached.get(link.id) ?? -1;
  furthestIndexReached.set(link.id, Math.max(previousFurthest, index));

  if (!match.link.active) return;

  const remaining = link.tracks.slice(index + 1);
  if (remaining.length === 0) return; // last track in the chain — nothing left to queue

  // Queue every remaining track in this chain now, not just the next one.
  // Queuing one-at-a-time (only adding the next track once its predecessor
  // starts playing) left a real gap: if someone manually added a track to
  // the queue while an earlier chain member was still playing, it could
  // land ahead of a later chain member that hadn't been queued yet,
  // breaking up the chain. Committing the whole remaining sequence up
  // front closes that gap.
  const queueUris = await getQueue();
  const queuedNames: string[] = [];

  for (const track of remaining) {
    if (queueUris.includes(track.uri)) continue; // already there
    await addToQueue(track.uri);
    queuedNames.push(track.name);
  }

  if (queuedNames.length === 1) {
    onAction?.(`Queued "${queuedNames[0]}" next`);
  } else if (queuedNames.length > 1) {
    onAction?.(`Queued ${queuedNames.length} tracks: ${queuedNames.join(", ")}`);
  }
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

      // If this chain has already reached the predecessor's position at
      // some point this session, it already had its turn — re-adding it
      // now would be wrong regardless of whether it was fully played
      // through or skipped past. This is the exact fix for a real bug:
      // correction was re-inserting already-played tracks it had no way
      // of knowing had already happened.
      const predecessorIndex = i - 1;
      if ((furthestIndexReached.get(link.id) ?? -1) >= predecessorIndex) continue;

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
  furthestIndexReached.clear();
}
