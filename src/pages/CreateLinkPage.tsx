import { useState } from "react";
import type { TrackSummary } from "../../electron/spotifyApi";
import TrackSearch from "../components/TrackSearch";

type SearchSlot = "anchor" | "before" | "after" | null;

export default function CreateLinkPage({
  onSaved,
  onCancel
}: {
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [before, setBefore] = useState<TrackSummary[]>([]);
  const [anchor, setAnchor] = useState<TrackSummary | null>(null);
  const [after, setAfter] = useState<TrackSummary[]>([]);
  const [activeSlot, setActiveSlot] = useState<SearchSlot>("anchor");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePick(track: TrackSummary) {
    if (activeSlot === "anchor") setAnchor(track);
    if (activeSlot === "before") setBefore((list) => [...list, track]);
    if (activeSlot === "after") setAfter((list) => [...list, track]);
    setActiveSlot(null);
  }

  async function handleSave() {
    if (!anchor) {
      setError("Search for a track to anchor this link first.");
      return;
    }
    const tracks = [...before, anchor, ...after];
    if (tracks.length < 2) {
      setError("Add at least one track before or after the anchor.");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await window.linksAPI.saveLink(tracks);
      onSaved();
    } catch (err) {
      console.error(err);
      setError("Couldn't save this link. Try again.");
      setSaving(false);
    }
  }

  return (
    <div className="screen screen-narrow">
      <h1 className="page-title">Create a link</h1>
      <p className="muted">Search for a track, then attach tracks before or after it.</p>

      {activeSlot && (
        <TrackSearch onPick={handlePick} onClose={() => setActiveSlot(null)} />
      )}

      {!activeSlot && (
        <div className="chain-builder">
          {before.map((track) => (
            <TrackRow key={track.uri} track={track} />
          ))}

          <SlotButton label="Add track before" onClick={() => setActiveSlot("before")} />

          {anchor ? (
            <TrackRow track={anchor} badge="Anchor" />
          ) : (
            <SlotButton label="Search for a track" onClick={() => setActiveSlot("anchor")} primary />
          )}

          <SlotButton label="Add track after" onClick={() => setActiveSlot("after")} />

          {after.map((track) => (
            <TrackRow key={track.uri} track={track} />
          ))}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="button-row">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save link"}
        </button>
      </div>
    </div>
  );
}

function TrackRow({ track, badge }: { track: TrackSummary; badge?: string }) {
  return (
    <div className="track-row">
      <div className="track-thumb" />
      <div className="track-info">
        <p className="track-name">{track.name}</p>
        <p className="track-artist">{track.artist}</p>
      </div>
      {badge && <span className="badge">{badge}</span>}
    </div>
  );
}

function SlotButton({
  label,
  onClick,
  primary
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button className={`slot-btn${primary ? " slot-btn-primary" : ""}`} onClick={onClick}>
      + {label}
    </button>
  );
}
