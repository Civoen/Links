import { useEffect, useState } from "react";
import type { TrackSummary } from "../../electron/spotifyApi";

function formatDuration(ms?: number): string {
  if (!ms) return "";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function TrackSearch({
  onPick,
  onClose
}: {
  onPick: (track: TrackSummary) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TrackSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const tracks = await window.linksAPI.searchTracks(query);
        setResults(tracks);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="search-panel">
      <div className="search-input-wrap">
        <input
          autoFocus
          className="search-input"
          placeholder="Search for a track"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>

      {loading && <p className="muted">Searching…</p>}

      {!loading && query.trim() && results.length > 0 && (
        <p className="search-hint">
          Same title showing up more than once? Check the album name below — a
          music video or alternate release often has its own separate entry.
        </p>
      )}

      <div className="search-results">
        {results.map((track) => (
          <button key={track.uri} className="track-row track-row-button" onClick={() => onPick(track)}>
            {track.albumArt ? (
              <img className="track-thumb" src={track.albumArt} alt="" />
            ) : (
              <div className="track-thumb" />
            )}
            <div className="track-info">
              <p className="track-name">{track.name}</p>
              <p className="track-artist">
                {track.artist}
                {track.album ? ` · ${track.album}` : ""}
              </p>
            </div>
            {track.durationMs && (
              <span className="track-duration">{formatDuration(track.durationMs)}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
