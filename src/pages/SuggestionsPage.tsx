import { useEffect, useState } from "react";
import type { PlaylistSummary, TrackSummary } from "../../electron/spotifyApi";
import LinkGlyph from "../components/LinkGlyph";

interface SuggestedLink {
  tracks: TrackSummary[];
}

type Step = "pickPlaylist" | "scanning" | "results";

export default function SuggestionsPage({
  onBack,
  onCreateFromSuggestion
}: {
  onBack: () => void;
  onCreateFromSuggestion: (tracks: TrackSummary[]) => void;
}) {
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [step, setStep] = useState<Step>("pickPlaylist");
  const [activePlaylist, setActivePlaylist] = useState<PlaylistSummary | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedLink[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.linksAPI.getPlaylists().then(setPlaylists);
  }, []);

  async function scanPlaylist(playlist: PlaylistSummary) {
    setActivePlaylist(playlist);
    setStep("scanning");
    setError(null);
    try {
      const found = await window.linksAPI.getSuggestions(playlist.id);
      setSuggestions(found);
      setStep("results");
    } catch (err) {
      console.error(err);
      setError("Couldn't scan that playlist. Try again.");
      setStep("pickPlaylist");
    }
  }

  return (
    <div className="screen screen-narrow">
      <div className="settings-header">
        <button className="icon-btn" aria-label="Back to your links" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="page-title">Suggested links</h1>
      </div>

      {step === "pickPlaylist" && (
        <>
          <p className="muted">
            Pick a playlist. Links looks for tracks from the same album, in
            a row, that are all sitting in it — the kind of thing that's
            usually meant to play together.
          </p>

          {error && <p className="error-text">{error}</p>}

          {playlists === null && <p className="muted">Loading your playlists…</p>}

          {playlists !== null && playlists.length === 0 && (
            <p className="muted">No playlists found on your account.</p>
          )}

          <div className="playlist-pick-list">
            {playlists?.map((playlist) => (
              <button
                key={playlist.id}
                className="playlist-pick-row"
                onClick={() => scanPlaylist(playlist)}
              >
                <span>{playlist.name}</span>
                <span className="muted">{playlist.trackCount} tracks</span>
              </button>
            ))}
          </div>
        </>
      )}

      {step === "scanning" && (
        <p className="muted">Scanning {activePlaylist?.name}…</p>
      )}

      {step === "results" && (
        <>
          <p className="muted">
            {suggestions.length === 0
              ? `Nothing obvious found in ${activePlaylist?.name}.`
              : `Found ${suggestions.length} possible link${suggestions.length === 1 ? "" : "s"} in ${activePlaylist?.name}.`}
          </p>

          <button className="btn" onClick={() => setStep("pickPlaylist")} style={{ marginBottom: 16 }}>
            Scan a different playlist
          </button>

          <div className="link-list">
            {suggestions.map((suggestion, i) => (
              <div className="link-card suggestion-card" key={i}>
                <div className="link-card-summary">
                  <div className="link-chain-thumbs">
                    {suggestion.tracks.map((track, j) => (
                      <div className="link-chain-thumb-wrap" key={track.uri + j}>
                        {track.albumArt ? (
                          <img className="link-chain-thumb" src={track.albumArt} alt={track.name} />
                        ) : (
                          <div className="link-chain-thumb link-chain-thumb-empty" />
                        )}
                        {j < suggestion.tracks.length - 1 && (
                          <span className="link-chain-connector">
                            <LinkGlyph size={11} />
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="link-card-body">
                    <p className="link-track-names">
                      {suggestion.tracks.map((t) => t.name).join(", ")}
                    </p>
                    <p className="link-meta">
                      {suggestion.tracks[0].artist} · {suggestion.tracks.length} tracks
                    </p>
                  </div>
                  <button
                    className="btn btn-primary suggestion-create-btn"
                    onClick={() => onCreateFromSuggestion(suggestion.tracks)}
                  >
                    Create
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
