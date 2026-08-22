import { getPlaybackState, addToQueue, getQueue } from "./spotifyApi";
import { findLinksByTrackIdentity, getLinks, type Link } from "./linkStore";
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
// Rounds of real-world bug reports shaped this file (abbreviated — full
// history in git):
//
// Round 1: neither Spotify's playback-state nor queue-read are reliable
// single-poll signals. Every "already handled" check requires confirmed
// state, not a single read.
//
// Round 2: state marking something "handled" was set before the action
// completed, not after — a failed attempt was silently abandoned instead
// of retried. Fixed by only committing after success.
//
// Round 3: queuing only one step ahead left a gap for 3+ track chains.
// Fixed by queuing the whole remaining chain at once.
//
// Round 4: correction had no memory of what had already played, so it
// would "fix" a pair that had simply already finished. Fixed by tracking
// the furthest position reached per link.
//
// Round 5: no Spotify endpoint exists to remove/clear queued tracks, so a
// deliberate switch to unrelated playback leaves orphaned tracks stuck —
// now explained once via a warning instead of left silent.
//
// Round 6: handleForwardChaining trusted Spotify's own queue-read to
// decide whether a track was "already there" before adding it — a false
// positive there caused a silent, total failure with no error shown.
// Fixed by tracking Links' own successful adds instead of trusting an
// external read.
//
// Round 7: a track belonging to more than one saved link only ever
// advanced the first match found, silently ignoring the others. Fixed by
// processing every matching link, not just the first.
//
// Round 8: failures were attributed generically ("something failed
// somewhere"), not to the specific link involved, and one link's failure
// inside a shared loop could affect bookkeeping for others. Every action
// and every failure now carries which link it's about.
//
// Round 9: a song released on both an EP and an album gets a different
// Spotify ID for each release. Exact-ID matching is still tried first;
// only when that finds nothing does the engine fall back to matching by
// normalized title + artist + a close duration.
//
// Round 10: a successful addToQueue response has never actually been
// verified to mean the track landed. Every successful add is now watched
// for a few ticks afterward; if it consistently never appears, Links
// quietly re-adds it and says so, rather than having silently claimed
// success and moved on.
//
// Round 11 (this round): the retry from Round 10 had no ceiling — a
// track that's persistently (not just transiently) failing to queue
// would retry forever, roughly every 9 seconds, indefinitely. That's the
// opposite of the actual goal: a failure that keeps happening should
// eventually stop retrying silently and clearly tell you, not loop
// while implying everything's fine each time it tries again.

let pollHandle: ReturnType<typeof setInterval> | null = null;
let lastActionedTrackUri: string | null = null;
const handledCorrections = new Set<string>();

// Increments once per tick — used only to give a just-added track at
// least one full tick of propagation time before verification starts
// checking for it, so a same-tick "not there yet" read doesn't
// immediately count as a miss.
let tickCounter = 0;

interface PendingVerification {
  linkId: string;
  trackName: string;
  queuedOnTick: number;
  misses: number;
  retryAttempts: number;
}

// Track URIs whose successful addToQueue call hasn't been confirmed to
// have actually landed yet. See "Round 10".
const pendingQueueVerification = new Map<string, PendingVerification>();

// How many consecutive ticks a track can fail to appear (and fail to
// start playing) before Links concludes the original add likely didn't
// land and retries it directly, rather than waiting indefinitely.
const VERIFICATION_MISS_THRESHOLD = 3;

// After this many retry attempts have all still failed to verify, Links
// stops retrying and surfaces a clear, final warning instead — see
// "Round 11". Two retries (three total tries counting the original)
// comfortably absorbs a rough patch without looping forever.
const MAX_VERIFICATION_RETRIES = 2;

// Which links have already gotten the one-time "matched by song title,
// not exact release" note this session, so it's mentioned once per link,
// not on every single track transition while it keeps happening.
const notedIdentityMatch = new Set<string>();

// Track URIs Links has itself successfully added to the queue this
// session. Cleared for a given track the moment it's observed actually
// playing (see the top of handleForwardChaining) — once a track starts,
// its "was it queued" bookkeeping is stale, and a future replay should
// get a fresh check rather than being silently blocked by leftover state.
const alreadyQueuedByUs = new Set<string>();

// The highest track index reached in each link during this run of the
// app — not persisted, and (deliberately, for simplicity) never reset
// mid-session, so replaying a link from the start later in the same
// session won't re-enable correction for positions already passed once.
const furthestIndexReached = new Map<string, number>();

// Which links we've already warned about having orphaned tracks stuck in
// the queue, so the warning fires once per situation, not every poll
// while it remains unresolved. Cleared the moment that link's tracks are
// no longer sitting in the queue, so a future recurrence warns again.
const notifiedOrphans = new Set<string>();

// Which links are currently in a failing state, per responsibility, so a
// sustained outage produces one warning per link, not one every three
// seconds. Cleared the moment that link's next attempt succeeds.
const forwardChainingFailing = new Set<string>();
const correctionFailing = new Set<string>();

const STOPPED_CONFIRMATION_TICKS = 2;
let consecutiveNotPlayingTicks = 0;

// Prevents two tick() calls from running at once. A single tick can make
// several sequential API calls; under real-world latency that can exceed
// POLL_INTERVAL_MS, and setInterval doesn't wait for the previous call to
// finish before firing the next one. Two overlapping ticks reading and
// writing the same shared state is exactly the kind of thing that
// produces intermittent, hard-to-reproduce bugs.
let tickInProgress = false;

let onAction: ((message: string, level: NotificationLevel, linkId?: string) => void) | null = null;

// Fires once per tick that actually ran to completion — deliberately not
// fired for a tick skipped by the tickInProgress guard, since that
// wouldn't be a genuine "the engine just checked in". Used to drive a
// liveness indicator that reflects real activity, not a decorative loop.
let onTick: (() => void) | null = null;

/**
 * Calls onAction defensively. onAction does real work with real failure
 * modes of its own (writing notification history to disk, IPC to the
 * renderer) — none of that should ever be able to make a genuinely
 * successful queue action look like it failed.
 */
function safeNotify(message: string, level: NotificationLevel, linkId?: string) {
  try {
    onAction?.(message, level, linkId);
  } catch (err) {
    console.error("[linkEngine] notification callback failed (core action still succeeded):", err);
  }
}

/** A short, human-readable name for a link in notification text — never says "Links failed", always names the actual link. */
function describeLink(link: Link): string {
  if (link.title) return link.title;
  const first = link.tracks[0];
  return first.album ? `${first.artist} · ${first.album}` : first.artist;
}

function registerPendingVerification(
  trackUri: string,
  trackName: string,
  linkId: string,
  retryAttempts = 0
) {
  pendingQueueVerification.set(trackUri, {
    linkId,
    trackName,
    queuedOnTick: tickCounter,
    misses: 0,
    retryAttempts
  });
}

/**
 * Checks every add that hasn't been confirmed yet against this tick's
 * queue read. A track is confirmed the moment it's actually playing (the
 * strongest possible signal) or shows up in the queue — either clears it.
 * Only after several consecutive misses does Links conclude the original
 * add likely never landed and retry it directly. See "Round 10".
 */
async function verifyPendingQueueAdds(currentTrackUri: string, queueUris: string[]) {
  for (const [trackUri, pending] of [...pendingQueueVerification.entries()]) {
    if (pending.queuedOnTick === tickCounter) continue; // give it at least one tick to propagate

    if (trackUri === currentTrackUri || queueUris.includes(trackUri)) {
      pendingQueueVerification.delete(trackUri);
      continue;
    }

    pending.misses++;
    if (pending.misses < VERIFICATION_MISS_THRESHOLD) continue;

    pendingQueueVerification.delete(trackUri);

    if (pending.retryAttempts >= MAX_VERIFICATION_RETRIES) {
      // Exhausted retries — a persistent, not transient, problem. Stop
      // looping and say so clearly, rather than retrying forever while
      // each attempt's message implies everything's fine. See "Round 11".
      safeNotify(
        `"${pending.trackName}" still hasn't shown up in Spotify's queue after a few attempts. This looks like a Spotify-side issue rather than something Links can resolve by retrying further — check Spotify's queue directly, or try skipping ahead.`,
        "warning",
        pending.linkId
      );
      alreadyQueuedByUs.delete(trackUri); // allow a completely fresh attempt if this track's chain position comes up again naturally
      continue;
    }

    try {
      await addToQueue(trackUri);
      registerPendingVerification(trackUri, pending.trackName, pending.linkId, pending.retryAttempts + 1);
      safeNotify(
        `"${pending.trackName}" didn't show up in Spotify's queue as expected, so Links added it again.`,
        "info",
        pending.linkId
      );
    } catch (err) {
      console.error(`[linkEngine] re-add after verification failure failed for ${trackUri}:`, err);
      // Let the natural forward-chaining retry mechanism have another go
      // later, rather than getting stuck retrying here indefinitely.
      alreadyQueuedByUs.delete(trackUri);
    }
  }
}

async function tick() {
  if (tickInProgress) return;
  tickInProgress = true;
  tickCounter++;

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
      // Only commit to "handled" once every matched link has been
      // attempted without throwing — if any of them failed, state.trackUri
      // stays != lastActionedTrackUri, so the whole thing gets retried
      // next tick rather than silently abandoned. See "Round 2".
      const allSucceeded = await handleForwardChaining(
        state.trackUri,
        state.trackName,
        state.trackArtist,
        state.trackDurationMs
      );
      if (allSucceeded) {
        lastActionedTrackUri = state.trackUri;
      }
    }

    const queueUris = await getQueue();
    checkForOrphanedLinks(state.trackUri, state.trackName, state.trackArtist, state.trackDurationMs, queueUris);
    await handleOutOfOrderCorrection(state.trackUri, queueUris);
    await verifyPendingQueueAdds(state.trackUri, queueUris);
  } catch (err) {
    console.error("[linkEngine] tick failed:", err);
  } finally {
    tickInProgress = false;
    try {
      onTick?.();
    } catch (err) {
      console.error("[linkEngine] onTick callback failed:", err);
    }
  }
}

/** Returns true only if every matched link was processed without error. */
async function handleForwardChaining(
  currentTrackUri: string,
  currentTrackName: string | null,
  currentTrackArtist: string | null,
  currentTrackDurationMs: number | null
): Promise<boolean> {
  // This track is now actually playing — any earlier "we queued it"
  // bookkeeping for it has done its job and is now stale. Clearing it
  // means a future replay of this same track gets a fresh, correct check
  // rather than being silently blocked by leftover state from last time.
  alreadyQueuedByUs.delete(currentTrackUri);

  // A track can legitimately belong to more than one saved link — see
  // "Round 7". Every match gets its own try/catch below, so one link
  // failing never blocks or gets confused with another. Exact-ID match is
  // tried first inside findLinksByTrackIdentity; the title+artist+duration
  // fallback only ever runs if that finds nothing at all — see "Round 9".
  const matches = findLinksByTrackIdentity(
    currentTrackUri,
    currentTrackName,
    currentTrackArtist,
    currentTrackDurationMs
  );
  if (matches.length === 0) return true;

  let allSucceeded = true;

  for (const { link, index, matchedBy } of matches) {
    try {
      const previousFurthest = furthestIndexReached.get(link.id) ?? -1;
      furthestIndexReached.set(link.id, Math.max(previousFurthest, index));

      if (!link.active) continue;

      if (matchedBy === "identity" && !notedIdentityMatch.has(link.id)) {
        notedIdentityMatch.add(link.id);
        safeNotify(
          `Recognized "${describeLink(link)}" by song title — this release's Spotify ID differs from what's saved in the link.`,
          "info",
          link.id
        );
      }

      const remaining = link.tracks.slice(index + 1);
      if (remaining.length === 0) continue; // last track in this chain — nothing left to queue

      // Queue every remaining track in this chain now, not just the next
      // one. See "Round 3".
      const queuedNames: string[] = [];

      for (const track of remaining) {
        // Skip only if WE ourselves already successfully queued this
        // track — never based on asking Spotify's queue-read to confirm
        // it. See "Round 6".
        if (alreadyQueuedByUs.has(track.uri)) continue;
        await addToQueue(track.uri);
        alreadyQueuedByUs.add(track.uri);
        registerPendingVerification(track.uri, track.name, link.id);
        queuedNames.push(track.name);
      }

      if (queuedNames.length === 1) {
        safeNotify(`Queued "${queuedNames[0]}" next`, "info", link.id);
      } else if (queuedNames.length > 1) {
        safeNotify(`Queued ${queuedNames.length} tracks: ${queuedNames.join(", ")}`, "info", link.id);
      }

      forwardChainingFailing.delete(link.id);
    } catch (err) {
      console.error(`[linkEngine] forward chaining failed for link ${link.id}:`, err);
      allSucceeded = false;

      if (!forwardChainingFailing.has(link.id)) {
        forwardChainingFailing.add(link.id);
        safeNotify(
          `Spotify didn't respond while Links tried to queue the next track in "${describeLink(link)}". Links will keep retrying automatically.`,
          "warning",
          link.id
        );
      }
    }
  }

  return allSucceeded;
}

/**
 * Warns, once per situation, when the listener has moved on to something
 * unrelated to any active link while that link's remaining tracks are
 * still sitting in the queue. Spotify's API has no way for an app to
 * remove or clear queued tracks, so this can't be fixed automatically —
 * only explained, clearly, and attributed to the actual constraint
 * rather than framed as Links failing to do something it could.
 */
function checkForOrphanedLinks(
  currentTrackUri: string,
  currentTrackName: string | null,
  currentTrackArtist: string | null,
  currentTrackDurationMs: number | null,
  queueUris: string[]
) {
  const currentMatches = findLinksByTrackIdentity(
    currentTrackUri,
    currentTrackName,
    currentTrackArtist,
    currentTrackDurationMs
  );

  for (const link of getLinks()) {
    if (!link.active) continue;

    // A link that's never actually been played this session has nothing
    // to be "orphaned" from — see "Round 4"'s reasoning applied here too:
    // one of its tracks sitting in the queue is coincidence, not evidence
    // this specific chain was started and abandoned.
    if ((furthestIndexReached.get(link.id) ?? -1) < 0) {
      notifiedOrphans.delete(link.id);
      continue;
    }

    const isOnThisLinkNow = currentMatches.some((m) => m.link.id === link.id);
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
    safeNotify(
      `${subject} still queued from earlier. Spotify doesn't give apps a way to clear queued tracks, so you'll need to skip past ${pronoun} yourself.`,
      "warning",
      link.id
    );
  }
}

async function handleOutOfOrderCorrection(currentTrackUri: string, queueUris: string[]) {
  const links = getLinks();
  if (links.length === 0) return;

  for (const link of links) {
    if (!link.active) continue;

    try {
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
        // now would be wrong. See "Round 4".
        const predecessorIndex = i - 1;
        if ((furthestIndexReached.get(link.id) ?? -1) >= predecessorIndex) continue;

        const predecessorAlreadyInPlace =
          predecessor.uri === currentTrackUri || queueUris.includes(predecessor.uri);

        if (predecessorAlreadyInPlace) continue;
        if (handledCorrections.has(correctionKey)) continue;

        // Mark as handled only after the add actually succeeds — see "Round 2".
        await addToQueue(predecessor.uri);
        handledCorrections.add(correctionKey);
        registerPendingVerification(predecessor.uri, predecessor.name, link.id);
        safeNotify(`Moved "${predecessor.name}" ahead of "${successor.name}"`, "info", link.id);
      }

      correctionFailing.delete(link.id);
    } catch (err) {
      console.error(`[linkEngine] correction failed for link ${link.id}:`, err);

      if (!correctionFailing.has(link.id)) {
        correctionFailing.add(link.id);
        safeNotify(
          `Spotify didn't respond while Links tried to fix the shuffled order in "${describeLink(link)}". Links will keep retrying automatically.`,
          "warning",
          link.id
        );
      }
    }
  }
}

export function startLinkEngine(
  actionCallback?: (message: string, level: NotificationLevel, linkId?: string) => void,
  tickCallback?: () => void
) {
  if (actionCallback) onAction = actionCallback;
  if (tickCallback) onTick = tickCallback;
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
  alreadyQueuedByUs.clear();
  notedIdentityMatch.clear();
  pendingQueueVerification.clear();
  forwardChainingFailing.clear();
  correctionFailing.clear();
}
