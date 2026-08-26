import type { TrackSummary } from "./spotifyApi";
import { searchTracks, getAlbumTracks } from "./spotifyApi";

/**
 * Finds likely siblings of a single track — used when building a link, to
 * suggest "also add Part 2?" right where the user is already working,
 * instead of requiring a separate playlist-scanning step. Two detectors,
 * same precision-over-recall philosophy as before: a wrong suggestion is
 * worse than a missed one.
 */
export async function findSiblingTracks(track: TrackSummary): Promise<TrackSummary[]> {
  const [fromAlbum, fromTitle] = await Promise.all([
    findAlbumPositionSiblings(track),
    findTitlePatternSiblings(track)
  ]);

  return dedupeByUri([...fromAlbum, ...fromTitle], track.uri);
}

/**
 * Detector 1: tracks immediately before/after this one on the same
 * album, by track number. Queries the album directly rather than relying
 * on a playlist happening to contain both — more precise, and doesn't
 * depend on what the user's playlists happen to include.
 */
async function findAlbumPositionSiblings(track: TrackSummary): Promise<TrackSummary[]> {
  if (!track.albumUri || track.trackNumber == null) return [];

  const albumTracks = await getAlbumTracks(track.albumUri);
  return albumTracks.filter(
    (t) =>
      t.uri !== track.uri &&
      t.trackNumber != null &&
      Math.abs(t.trackNumber - track.trackNumber!) === 1
  );
}

/**
 * Detector 2: other tracks by the same artist whose title matches a
 * recognizable sequential-naming pattern with an adjacent sequence value
 * — "Part 2", "Pt. 2", or a trailing roman numeral. Catches multi-part
 * songs on different albums, or the same album without adjacent track
 * numbers (a compilation or reissue can reorder tracks).
 */
async function findTitlePatternSiblings(track: TrackSummary): Promise<TrackSummary[]> {
  const parsed = parseSequenceTitle(track.name);
  if (!parsed) return [];

  const results = await searchTracks(`${track.artist} ${parsed.baseTitle}`);

  return results.filter((t) => {
    if (t.uri === track.uri) return false;
    if (t.artist.toLowerCase() !== track.artist.toLowerCase()) return false;
    const otherParsed = parseSequenceTitle(t.name);
    if (!otherParsed || otherParsed.baseTitle !== parsed.baseTitle) return false;
    return Math.abs(otherParsed.sequenceValue - parsed.sequenceValue) === 1;
  });
}

export interface ParsedSequenceTitle {
  baseTitle: string; // lowercased, trimmed — used only for grouping, never displayed
  sequenceValue: number;
}

/**
 * Deliberately narrower than it could be: intro/outro pairs, "(Live)" /
 * "(Remix)" suffixes, and bare trailing numbers without a "Part"/"Pt."
 * qualifier are all left alone, since none of those reliably indicate an
 * intended sequence the way an explicit part marker or roman numeral
 * does — matching them would trade real precision for speculative recall.
 */
export function parseSequenceTitle(trackName: string): ParsedSequenceTitle | null {
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

function dedupeByUri(tracks: TrackSummary[], excludeUri: string): TrackSummary[] {
  const seen = new Set<string>([excludeUri]);
  const result: TrackSummary[] = [];
  for (const t of tracks) {
    if (seen.has(t.uri)) continue;
    seen.add(t.uri);
    result.push(t);
  }
  return result;
}
