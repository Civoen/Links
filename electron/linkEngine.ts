import {
  getPlaybackState,
  addToQueue,
  getQueue,
  PremiumRequiredError,
  isRateLimited,
  getRateLimitRemainingSeconds,
  type QueuedTrack,
  type TrackSummary
} from "./spotifyApi";
import {
  findLinksByTrackIdentity,
  getLinks,
  normalizeForMatching,
  IDENTITY_DURATION_TOLERANCE_MS,
  type Link
} from "./linkStore";
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
// Round 11: the retry from Round 10 had no ceiling — a track that's
// persistently (not just transiently) failing to queue would retry
// forever, roughly every 9 seconds, indefinitely. That's the opposite of
// the actual goal: a failure that keeps happening should eventually stop
// retrying silently and clearly tell you, not loop while implying
// everything's fine each time it tries again.
//
// Round 12: forward-chaining was firing even when the currently-playing
// context is an album with shuffle off — but an album's own stored order
// already keeps a multi-part song's parts adjacent, so it was going to
// play the next part on its own regardless.
//
// Round 13 (this round): furthestIndexReached only ever grew, never
// reset, for the entire app session. That correctly prevented Round 4's
// bug (re-inserting a track that already legitimately played) — but it
// also meant that once a link had been played through ONE time, that
// memory permanently blocked correction from ever fixing that same pair
// again, even for a genuinely separate, later occurrence of the same
// link (e.g. replaying the same playlist, or encountering the same pair
// in a different context much later in a long-running session). There's
// no clean way to detect "a new occurrence has started" before
// correction needs to act — that's precisely the moment the predecessor
// hasn't played yet in the new context, so nothing triggers a reset.
// Instead, the memory now expires after a period long enough to
// comfortably cover a continuous listening stretch, short enough that a
// genuinely separate later occurrence gets a fresh, correct evaluation.
// This is a heuristic, not a precise detection — there's no way to know
// for certain from the data available whether 20 minutes represents
// "still the same continuous listen" or "a new one", so the window is a
// reasonable compromise, not a guarantee.

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

// The highest track index reached in each link, along with when that was
// last updated — see "Round 13". Not a simple always-growing maximum
// anymore; see getFreshFurthestIndex below for how expiry is applied.
const furthestIndexReached = new Map<string, { index: number; reachedAt: number }>();

// How long "this position was already reached" stays valid. Long enough
// to comfortably cover a continuous listening stretch (the natural
// remainder of an album or playlist after a linked pair), short enough
// that encountering the same pair again much later — a genuinely
// separate occurrence — gets a fresh, correct evaluation rather than
// being silently blocked by a stale memory from earlier in the session.
const FURTHEST_INDEX_EXPIRY_MS = 20 * 60 * 1000; // 20 minutes

/** The furthest index reached for a link, or -1 if never reached or that memory has expired. */
function getFreshFurthestIndex(linkId: string): number {
  const entry = furthestIndexReached.get(linkId);
  if (!entry) return -1;
  if (Date.now() - entry.reachedAt >= FURTHEST_INDEX_EXPIRY_MS) return -1;
  return entry.index;
}

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

// The most recently observed playback context, for surfacing on the
// Health page so someone can see what Links currently understands about
// their listening — directly useful for exactly the kind of "why isn't
// this working" questions this project has spent a lot of effort on.
export interface CurrentContext {
  isPlaying: boolean;
  contextType: string | null;
  shuffle: boolean;
  observedAt: number;
}
let currentContext: CurrentContext | null = null;

export function getCurrentContext(): CurrentContext | null {
  return currentContext;
}

// Whether the one-time "Spotify asked Links to slow down" notice has
// already fired for the current backoff window, so it doesn't repeat
// every 3 seconds while waiting it out.
let notifiedRateLimit = false;

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
        `"${pending.trackName}" still hasn't shown up in Spotify's queue after a few attempts. This looks like a Spotify-side issue rather than something Links can resolve by retrying further, check Spotify's queue directly, or try skipping ahead.`,
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
    if (isRateLimited()) {
      if (!notifiedRateLimit) {
        notifiedRateLimit = true;
        safeNotify(
          `Spotify has asked Links to slow down temporarily. Links will resume checking in about ${getRateLimitRemainingSeconds()}s.`,
          "warning"
        );
      }
      return;
    }
    notifiedRateLimit = false;

    const state = await getPlaybackState();
    currentContext = {
      isPlaying: state.isPlaying,
      contextType: state.contextType,
      shuffle: state.shuffle,
      observedAt: Date.now()
    };

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
      // next tick rather than silently abandoned. See "Round 2". A
      // suppressed attempt (see "Round 12") also returns false here,
      // which is deliberate — see that function's comment for why.
      const allSucceeded = await handleForwardChaining(
        state.trackUri,
        state.trackName,
        state.trackArtist,
        state.trackDurationMs,
        state.contextType,
        state.shuffle
      );
      if (allSucceeded) {
        lastActionedTrackUri = state.trackUri;
      }
    }

    const queue = await getQueue();
    const queueUris = queue.map((t) => t.uri);
    checkForOrphanedLinks(state.trackUri, state.trackName, state.trackArtist, state.trackDurationMs, queueUris);
    await handleOutOfOrderCorrection(
      state.trackUri,
      state.trackName,
      state.trackArtist,
      state.trackDurationMs,
      queue
    );
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

/**
 * Links exists specifically to counteract shuffle scrambling track
 * order. An album's own stored track order already reliably keeps a
 * multi-part song's parts adjacent — that's how albums get sequenced in
 * the first place — so playing an album with shuffle off will naturally
 * continue from Part 1 into Part 2 on its own. Links adding the same
 * track on top of that doesn't fix anything; it creates a genuine
 * duplicate, since the track was already about to play next regardless.
 * A playlist has no equivalent guarantee — its stored order says nothing
 * about whether linked tracks happen to be adjacent — so Links stays
 * active for playlists even without shuffle. And shuffle being on stays
 * active regardless of context, since shuffle can scramble an album's
 * order too, which is exactly the situation Links exists for.
 */
function shouldSuppressForNaturalAlbumOrder(contextType: string | null, shuffle: boolean): boolean {
  return contextType === "album" && !shuffle;
}

/** Returns true only if every matched link was processed without error. */
async function handleForwardChaining(
  currentTrackUri: string,
  currentTrackName: string | null,
  currentTrackArtist: string | null,
  currentTrackDurationMs: number | null,
  contextType: string | null,
  shuffle: boolean
): Promise<boolean> {
  // Deliberately returns false, not true, when suppressed — see "Round
  // 12". Returning true would commit lastActionedTrackUri for this
  // track, which would prevent re-evaluating it if shuffle gets toggled
  // on later while the same track is still playing. Returning false
  // means the next tick re-checks this same track fresh, so turning
  // shuffle on mid-track correctly and immediately un-suppresses it.
  if (shouldSuppressForNaturalAlbumOrder(contextType, shuffle)) return false;

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
      const previousFurthest = getFreshFurthestIndex(link.id);
      furthestIndexReached.set(link.id, { index: Math.max(previousFurthest, index), reachedAt: Date.now() });

      if (!link.active) continue;

      if (matchedBy === "identity" && !notedIdentityMatch.has(link.id)) {
        notedIdentityMatch.add(link.id);
        safeNotify(
          `Recognized "${describeLink(link)}" by song title, this release's Spotify ID differs from what's saved in the link.`,
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
          err instanceof PremiumRequiredError
            ? `Spotify Premium is required for Links to manage your queue. "${describeLink(link)}" won't be queued until Premium is active on this account again.`
            : `Spotify didn't respond while Links tried to queue the next track in "${describeLink(link)}". Links will keep retrying automatically.`,
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
    if (getFreshFurthestIndex(link.id) < 0) {
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

/**
 * Whether a stored link track matches a candidate track (from the queue,
 * or the currently-playing track) — exact URI first, falling back to
 * normalized title + artist + a close duration if that finds nothing.
 * Reuses the exact same matching logic forward-chaining uses (see
 * findLinksByTrackIdentity in linkStore.ts, "Round 9") so correction gets
 * the same same-recording-different-release recognition — previously a
 * known, explicitly-flagged gap: forward-chaining could recognize a
 * chain starting via a different release, but correction still needed
 * an exact stored URI to notice a pair was out of order.
 */
function matchesTrackIdentity(
  track: TrackSummary,
  candidateUri: string,
  candidateName: string | null | undefined,
  candidateArtist: string | null | undefined,
  candidateDurationMs: number | null | undefined
): boolean {
  if (track.uri === candidateUri) return true;
  if (!candidateName || !candidateArtist) return false;
  if (normalizeForMatching(track.name) !== normalizeForMatching(candidateName)) return false;
  if (normalizeForMatching(track.artist) !== normalizeForMatching(candidateArtist)) return false;
  if (track.durationMs != null && candidateDurationMs != null) {
    return Math.abs(track.durationMs - candidateDurationMs) <= IDENTITY_DURATION_TOLERANCE_MS;
  }
  return true;
}

function isTrackInQueue(queue: QueuedTrack[], track: TrackSummary): boolean {
  return queue.some((q) => matchesTrackIdentity(track, q.uri, q.name, q.artist, q.durationMs));
}

async function handleOutOfOrderCorrection(
  currentTrackUri: string,
  currentTrackName: string | null,
  currentTrackArtist: string | null,
  currentTrackDurationMs: number | null,
  queue: QueuedTrack[]
) {
  const links = getLinks();
  if (links.length === 0) return;

  for (const link of links) {
    if (!link.active) continue;

    try {
      for (let i = 1; i < link.tracks.length; i++) {
        const predecessor = link.tracks[i - 1];
        const successor = link.tracks[i];
        const correctionKey = `${link.id}:${i}`;

        if (matchesTrackIdentity(successor, currentTrackUri, currentTrackName, currentTrackArtist, currentTrackDurationMs)) {
          handledCorrections.delete(correctionKey);
          continue;
        }

        if (queue.length === 0) continue;

        const successorIsUpcoming = isTrackInQueue(queue, successor);
        if (!successorIsUpcoming) continue;

        // If this chain has already reached the predecessor's position at
        // some point this session, it already had its turn — re-adding it
        // now would be wrong. See "Round 4".
        const predecessorIndex = i - 1;
        if (getFreshFurthestIndex(link.id) >= predecessorIndex) continue;

        const predecessorAlreadyInPlace =
          matchesTrackIdentity(predecessor, currentTrackUri, currentTrackName, currentTrackArtist, currentTrackDurationMs) ||
          isTrackInQueue(queue, predecessor);

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
          err instanceof PremiumRequiredError
            ? `Spotify Premium is required for Links to manage your queue. Shuffle order in "${describeLink(link)}" won't be corrected until Premium is active on this account again.`
            : `Spotify didn't respond while Links tried to fix the shuffled order in "${describeLink(link)}". Links will keep retrying automatically.`,
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
  notifiedRateLimit = false;
  currentContext = null;
  handledCorrections.clear();
  furthestIndexReached.clear();
  notifiedOrphans.clear();
  alreadyQueuedByUs.clear();
  notedIdentityMatch.clear();
  pendingQueueVerification.clear();
  forwardChainingFailing.clear();
  correctionFailing.clear();
}
