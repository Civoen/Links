import type { TrackSummary } from "./spotifyApi";
import { getLinks } from "./linkStore";

export interface SuggestedLink {
  tracks: TrackSummary[];
}

/**
 * Finds groups of tracks that look like they belong together — same
 * album, consecutive track numbers, and both/all present in this
 * playlist. This is a deliberately simple, high-confidence heuristic: it
 * won't catch every "these belong together" case (a compilation that
 * reorders tracks, or two versions of a song released separately with no
 * shared album), but a suggestion that's wrong is worse than one that's
 * merely incomplete, so precision is favored over recall here.
 */
export function findSuggestedLinks(playlistTracks: TrackSummary[]): SuggestedLink[] {
  const existingPairs = alreadyLinkedPairs();

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

  // Drop anything that's fully covered by an existing link already.
  return suggestions.filter((s) => !isFullyCovered(s.tracks, existingPairs));
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
