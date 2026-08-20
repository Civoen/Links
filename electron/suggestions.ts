import type { TrackSummary } from "./spotifyApi";
import { getLinks } from "./linkStore";

export interface SuggestedLink {
  tracks: TrackSummary[];
}

/**
 * Finds groups of tracks that look like they belong together, using two
 * independent detectors. Both are deliberately conservative: a wrong
 * suggestion is worse than a missed one, so precision is favored over
 * recall throughout this file.
 */
export function findSuggestedLinks(playlistTracks: TrackSummary[]): SuggestedLink[] {
  const existingPairs = alreadyLinkedPairs();

  const fromAlbumPosition = findAlbumPositionSuggestions(playlistTracks);
  const fromTitlePattern = findTitlePatternSuggestions(playlistTracks);

  const merged = dedupeByTrackSequence([...fromAlbumPosition, ...fromTitlePattern]);

  // Drop anything that's fully covered by an existing link already.
  return merged.filter((s) => !isFullyCovered(s.tracks, existingPairs));
}

/**
 * Detector 1: same album, consecutive track numbers, and both/all present
 * in this playlist. Won't catch a compilation that reorders tracks, or a
 * multi-part song split across separate releases with no shared album —
 * see findTitlePatternSuggestions for that case.
 */
function findAlbumPositionSuggestions(playlistTracks: TrackSummary[]): SuggestedLink[] {
  const byAlbum = new Map<string, TrackSummary[]>();
  for (const track of playlistTracks) {
    if (!track.albumUri || track.trackNumber == null) continue;
    const group = byAlbum.get(track.albumUri) ?? [];
    group.push(track);
    byAlbum.set(track.albumUri, group);
  }

  const suggestions: SuggestedLink[] = [];

  for (const group of byAlbum.values()) {
    if (group.length < 2) continue;

    const sorted = [...group].sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0));

    let run: TrackSummary[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const isConsecutive = (curr.trackNumber ?? 0) === (prev.trackNumber ?? 0) + 1;

      if (isConsecutive) {
        run.push(curr);
      } else {
        if (run.length >= 2) suggestions.push({ tracks: run });
        run = [curr];
      }
    }
    if (run.length >= 2) suggestions.push({ tracks: run });
  }

  return suggestions;
}

/**
 * Detector 2: track titles that follow a recognizable sequential-naming
 * pattern — "Part 2", "Pt. 2", or a trailing roman numeral (with or
 * without a ": subtitle" after it, e.g. "Pain Remains I: Dancing Like
 * Flames"). Grouped by artist + the shared base title, so this catches
 * multi-part songs even when they're on different albums, or the same
 * album but not stored with consecutive track numbers (a compilation or
 * reissue can reorder tracks).
 *
 * Deliberately narrower than it could be: intro/outro pairs, "(Live)" /
 * "(Remix)" suffixes, and bare trailing numbers without a "Part"/"Pt."
 * qualifier are all left alone, since none of those reliably indicate an
 * intended sequence the way an explicit part marker or roman numeral
 * does — matching them would trade real precision for speculative recall.
 */
function findTitlePatternSuggestions(playlistTracks: TrackSummary[]): SuggestedLink[] {
  const groups = new Map<string, { track: TrackSummary; sequenceValue: number }[]>();

  for (const track of playlistTracks) {
    const parsed = parseSequenceTitle(track.name);
    if (!parsed) continue;

    const key = `${track.artist.toLowerCase()}|||${parsed.baseTitle}`;
    const group = groups.get(key) ?? [];
    group.push({ track, sequenceValue: parsed.sequenceValue });
    groups.set(key, group);
  }

  const suggestions: SuggestedLink[] = [];

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const sorted = [...group].sort((a, b) => a.sequenceValue - b.sequenceValue);

    // Same "maximal consecutive run" logic as the album-position detector —
    // Part 1 + Part 5 with Parts 2–4 missing from the playlist shouldn't
    // be suggested as a chain.
    let run: TrackSummary[] = [sorted[0].track];
    for (let i = 1; i < sorted.length; i++) {
      const isConsecutive = sorted[i].sequenceValue === sorted[i - 1].sequenceValue + 1;
      if (isConsecutive) {
        run.push(sorted[i].track);
      } else {
        if (run.length >= 2) suggestions.push({ tracks: run });
        run = [sorted[i].track];
      }
    }
    if (run.length >= 2) suggestions.push({ tracks: run });
  }

  return suggestions;
}

interface ParsedSequenceTitle {
  baseTitle: string; // lowercased, trimmed — used only for grouping, never displayed
  sequenceValue: number;
}

function parseSequenceTitle(trackName: string): ParsedSequenceTitle | null {
  // "<base>, Part 2" | "<base> (Pt. 2)" | "<base> Pt.2" | "<base>: Part 2" — explicit qualifier required
  // for arabic numerals, since a bare trailing number is too ambiguous on its own (e.g. "Blink 182").
  const partMatch = trackName.match(/^(.+?)[,:\s]+\(?(?:pt\.?|part)\s*(\d{1,3})\)?\s*:?\s*.*$/i);
  if (partMatch) {
    const base = partMatch[1].trim().toLowerCase();
    const num = parseInt(partMatch[2], 10);
    if (base && !isNaN(num)) return { baseTitle: base, sequenceValue: num };
  }

  // Trailing roman numeral, optionally followed by ": subtitle" — e.g.
  // "Pain Remains I: Dancing Like Flames". No qualifier word needed here,
  // since a bare trailing roman numeral is a well-established convention
  // specifically for multi-part songs and rarely means anything else in
  // a track title.
  const romanMatch = trackName.match(/^(.+?)\s+([IVXivx]{1,6})(?::\s.*)?$/);
  if (romanMatch) {
    const base = romanMatch[1].trim().toLowerCase();
    const num = romanNumeralToNumber(romanMatch[2].toUpperCase());
    if (base && num !== null && num >= 1 && num <= 20) {
      return { baseTitle: base, sequenceValue: num };
    }
  }

  return null;
}

/** Strict roman numeral parsing (1–39 range is far more than any song part number needs) — rejects malformed input rather than guessing. */
function romanNumeralToNumber(token: string): number | null {
  const VALID = /^(X{0,3})(IX|IV|V?I{0,3})$/;
  if (!token || !VALID.test(token)) return null;

  const values: Record<string, number> = { I: 1, V: 5, X: 10 };
  let total = 0;
  for (let i = 0; i < token.length; i++) {
    const current = values[token[i]];
    const next = values[token[i + 1]];
    if (next && current < next) {
      total -= current;
    } else {
      total += current;
    }
  }
  return total;
}

/** Removes duplicate suggestions (same tracks, same order) that both detectors independently found. */
function dedupeByTrackSequence(suggestions: SuggestedLink[]): SuggestedLink[] {
  const seen = new Set<string>();
  const result: SuggestedLink[] = [];

  for (const suggestion of suggestions) {
    const key = suggestion.tracks.map((t) => t.uri).join(">");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(suggestion);
  }

  return result;
}

function alreadyLinkedPairs(): Set<string> {
  const pairs = new Set<string>();
  for (const link of getLinks()) {
    for (let i = 1; i < link.tracks.length; i++) {
      pairs.add(`${link.tracks[i - 1].uri}>${link.tracks[i].uri}`);
    }
  }
  return pairs;
}

function isFullyCovered(tracks: TrackSummary[], existingPairs: Set<string>): boolean {
  for (let i = 1; i < tracks.length; i++) {
    if (!existingPairs.has(`${tracks[i - 1].uri}>${tracks[i].uri}`)) return false;
  }
  return true;
}
