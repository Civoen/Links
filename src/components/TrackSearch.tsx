import { useEffect, useState } from "react";
import type { TrackSummary } from "../../electron/spotifyApi";

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

      <div className="search-results">
        {results.map((track) => (
          <button key={track.uri} className="track-row track-row-button" onClick={() => onPick(track)}>
            <div className="track-thumb" />
            <div className="track-info">
              <p className="track-name">{track.name}</p>
              <p className="track-artist">{track.artist}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
