import { getPlaybackState, addToQueue, getQueue } from "./spotifyApi";
import { findLinkByTrackUri, getLinks } from "./linkStore";
import { POLL_INTERVAL_MS } from "./config";

export type NotificationLevel = "info" | "warning";

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
// Rounds of real-world bug reports shaped this file:
//
// Round 1 (duplicate adds): neither Spotify's playback-state nor its
// queue-read endpoint are fully reliable single-poll signals. Every
// "have I already handled this" check requires *confirmed* state, not a
// single read, so one flaky poll can't cause a duplicate add.
//
// Round 2 (randomly missed adds): the state that marks something as
// "handled" was being set *before* the action that does the actual work,
// not after. Every "mark as handled" step now happens only after the
// corresponding action has actually completed, so a failed attempt gets
// retried instead of silently abandoned.
//
// Round 3 (chain broken by a manual queue addition): queuing only one
// step ahead left a real gap for 3+ track chains — a manually-queued
// track could land ahead of a later chain member Links hadn't queued yet.
// Queuing the whole remaining chain the moment the first track starts
// closes that gap.
//
// Round 4 (a track re-added after already being played): correction had
// no memory of what had already played in this session, so it would
// "fix" a pair that wasn't actually broken — just already finished.
// Correction now tracks the furthest position reached in each link and
// never touches a pair whose predecessor position has already passed.
//
// Round 5 (silent gaps when someone plays something else entirely):
// Spotify's Web API has no endpoint to remove or clear queued tracks —
// confirmed against Spotify's own current API reference, not assumed —
// so if someone deliberately starts playing an unrelated track while
// linked tracks are still sitting in the queue, Links has no way to
// clean that up. It can at least say so clearly, once, rather than leave
// it as an unexplained leftover.

let pollHandle: ReturnType<typeof setInterval> | null = null;
let lastActionedTrackUri: string | null = null;
const handledCorrections = new Set<string>();

// The highest track index reached in each link during this run of the
// app — not persisted, and (deliberately, for simplicity) never reset
// mid-session, so replaying a link from the start later in the same
// session won't re-enable correction for positions already passed once.
const furthestIndexReached = new Map<string, number>();

// Which links we've already warned about having orphaned tracks stuck in
// the queue, so the warning fires once per situation, not every poll
// while it remains unresolved. Cleared the moment that link's tracks are
// no longer sitting in the queue (whether the listener skipped past them
// or they eventually played through), so a future recurrence warns again.
const notifiedOrphans = new Set<string>();

// Whether the most recent attempt at each responsibility failed, so a
// sustained outage produces one warning, not one every three seconds.
// Cleared the moment that responsibility next succeeds.
let forwardChainingFailing = false;
let correctionFailing = false;

const STOPPED_CONFIRMATION_TICKS = 2;
let consecutiveNotPlayingTicks = 0;

// Prevents two tick() calls from running at once. A single tick can make
// several sequential API calls; under real-world latency that can exceed
// POLL_INTERVAL_MS, and setInterval doesn't wait for the previous call to
// finish before firing the next one. Two overlapping ticks reading and
// writing the same shared state is exactly the kind of thing that
// produces intermittent, hard-to-reproduce bugs.
let tickInProgress = false;

let onAction: ((message: string, level: NotificationLevel) => void) | null = null;

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
      try {
        // Only commit to "handled" after this actually completes without
        // throwing — if it fails partway through, state.trackUri is
        // still != lastActionedTrackUri on the next tick, so it gets
        // retried instead of silently skipped forever.
        await handleForwardChaining(state.trackUri);
        lastActionedTrackUri = state.trackUri;
        forwardChainingFailing = false;
      } catch (err) {
        console.error("[linkEngine] forward chaining failed:", err);
        if (!forwardChainingFailing) {
          forwardChainingFailing = true;
          onAction?.(
            "Spotify didn't respond while Links tried to queue a linked track. Links will keep retrying automatically.",
            "warning"
          );
        }
      }
    }

    const queueUris = await getQueue();
    checkForOrphanedLinks(state.trackUri, queueUris);

    try {
      await handleOutOfOrderCorrection(state.trackUri, queueUris);
      correctionFailing = false;
    } catch (err) {
      console.error("[linkEngine] correction failed:", err);
      if (!correctionFailing) {
        correctionFailing = true;
        onAction?.(
          "Spotify didn't respond while Links tried to fix a shuffled link order. Links will keep retrying automatically.",
          "warning"
        );
      }
    }
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
  // Queuing one-at-a-time left a real gap for 3+ track chains — see
  // "Round 3" above.
  const queueUris = await getQueue();
  const queuedNames: string[] = [];

  for (const track of remaining) {
    if (queueUris.includes(track.uri)) continue; // already there
    await addToQueue(track.uri);
    queuedNames.push(track.name);
  }

  if (queuedNames.length === 1) {
    onAction?.(`Queued "${queuedNames[0]}" next`, "info");
  } else if (queuedNames.length > 1) {
    onAction?.(`Queued ${queuedNames.length} tracks: ${queuedNames.join(", ")}`, "info");
  }
}

/**
 * Warns, once per situation, when the listener has moved on to something
 * unrelated to any active link while that link's remaining tracks are
 * still sitting in the queue. Spotify's API has no way for an app to
 * remove or clear queued tracks, so this can't be fixed automatically —
 * only explained, clearly, and attributed to the actual constraint
 * rather than framed as Links failing to do something it could.
 */
function checkForOrphanedLinks(currentTrackUri: string, queueUris: string[]) {
  const currentMatch = findLinkByTrackUri(currentTrackUri);

  for (const link of getLinks()) {
    if (!link.active) continue;

    const isOnThisLinkNow = currentMatch?.link.id === link.id;
    const orphanedTracks = link.tracks.filter((t) => queueUris.includes(t.uri));

    if (isOnThisLinkNow || orphanedTracks.length === 0) {
      notifiedOrphans.delete(link.id); // situation resolved — allow a future warning if it recurs
      continue;
    }

    if (notifiedOrphans.has(link.id)) continue; // already warned, don't repeat every poll

    notifiedOrphans.add(link.id);
    const names = orphanedTracks.map((t) => t.name);
    const subject = names.length === 1 ? `"${names[0]}" is` : `${names.join(", ")} are`;
    const pronoun = names.length === 1 ? "it" : "them";
    onAction?.(
      `${subject} still queued from earlier. Spotify doesn't give apps a way to clear queued tracks, so you'll need to skip past ${pronoun} yourself.`,
      "warning"
    );
  }
}

async function handleOutOfOrderCorrection(currentTrackUri: string, queueUris: string[]) {
  const links = getLinks();
  if (links.length === 0) return;

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
      // through or skipped past. See "Round 4" above.
      const predecessorIndex = i - 1;
      if ((furthestIndexReached.get(link.id) ?? -1) >= predecessorIndex) continue;

      const predecessorAlreadyInPlace =
        predecessor.uri === currentTrackUri || queueUris.includes(predecessor.uri);

      if (predecessorAlreadyInPlace) continue;
      if (handledCorrections.has(correctionKey)) continue;

      // Mark as handled only after the add actually succeeds — see
      // "Round 2" above.
      await addToQueue(predecessor.uri);
      handledCorrections.add(correctionKey);
      onAction?.(`Moved "${predecessor.name}" ahead of "${successor.name}"`, "info");
    }
  }
}

export function startLinkEngine(actionCallback?: (message: string, level: NotificationLevel) => void) {
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
  notifiedOrphans.clear();
  forwardChainingFailing = false;
  correctionFailing = false;
}
