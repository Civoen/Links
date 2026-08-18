import { useState } from "react";
import type { TrackSummary } from "../../electron/spotifyApi";
import type { Link } from "../../electron/linkStore";
import TrackSearch from "../components/TrackSearch";

function formatDuration(ms?: number): string {
  if (!ms) return "";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function CreateLinkPage({
  editingLink,
  initialTracks,
  onSaved,
  onCancel
}: {
  editingLink?: Link;
  initialTracks?: TrackSummary[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [tracks, setTracks] = useState<TrackSummary[]>(editingLink?.tracks ?? initialTracks ?? []);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openSearchAt(index: number) {
    setError(null);
    setInsertAt(index);
  }

  function handlePick(track: TrackSummary) {
    if (insertAt === null) return;
    setTracks((current) => {
      const next = [...current];
      next.splice(insertAt, 0, track);
      return next;
    });
    setInsertAt(null);
  }

  function handleRemove(index: number) {
    setTracks((current) => current.filter((_, i) => i !== index));
  }

  function handleDrop(targetIndex: number) {
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }
    setTracks((current) => {
      const next = [...current];
      const [moved] = next.splice(draggedIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDraggedIndex(null);
    setDragOverIndex(null);
  }

  async function handleSave() {
    if (tracks.length < 2) {
      setError("Add at least two tracks to create a link.");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      if (editingLink) {
        await window.linksAPI.updateLink(editingLink.id, tracks);
      } else {
        await window.linksAPI.saveLink(tracks);
      }
      onSaved();
    } catch (err) {
      console.error(err);
      setError("Couldn't save this link. Try again.");
      setSaving(false);
    }
  }

  const title = editingLink ? "Edit link" : "Create a link";

  if (insertAt !== null) {
    return (
      <div className="screen screen-narrow">
        <h1 className="page-title">{title}</h1>
        <TrackSearch onPick={handlePick} onClose={() => setInsertAt(null)} />
      </div>
    );
  }

  return (
    <div className="screen screen-narrow">
      <h1 className="page-title">{title}</h1>
      <p className="muted">
        Search for tracks, drag to reorder, and add more anywhere in the chain.
      </p>

      <div className="chain-builder">
        {tracks.length === 0 ? (
          <button className="empty-slot-btn" onClick={() => openSearchAt(0)}>
            <span className="empty-slot-icon">+</span>
            Search for a track to start the chain
          </button>
        ) : (
          <InsertPoint onClick={() => openSearchAt(0)} />
        )}

        {tracks.map((track, index) => (
          <div key={`${track.uri}-${index}`}>
            <div
              className={`chain-track${dragOverIndex === index ? " chain-track-drop-target" : ""}`}
              draggable
              onDragStart={() => setDraggedIndex(index)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverIndex(index);
              }}
              onDragLeave={() => setDragOverIndex((current) => (current === index ? null : current))}
              onDrop={() => handleDrop(index)}
              onDragEnd={() => {
                setDraggedIndex(null);
                setDragOverIndex(null);
              }}
            >
              <span className="drag-handle" aria-hidden="true">
                <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
                  <circle cx="2" cy="2" r="1.5" /><circle cx="8" cy="2" r="1.5" />
                  <circle cx="2" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" />
                  <circle cx="2" cy="14" r="1.5" /><circle cx="8" cy="14" r="1.5" />
                </svg>
              </span>

              {track.albumArt ? (
                <img className="track-thumb" src={track.albumArt} alt="" />
              ) : (
                <div className="track-thumb" />
              )}

              <div className="track-info">
                <p className="track-name">{track.name}</p>
                <p className="track-artist">{track.artist}</p>
              </div>

              {track.durationMs && (
                <span className="track-duration">{formatDuration(track.durationMs)}</span>
              )}

              <button
                className="icon-btn"
                aria-label={`Remove ${track.name}`}
                onClick={() => handleRemove(index)}
              >
                ✕
              </button>
            </div>

            <InsertPoint onClick={() => openSearchAt(index + 1)} />
          </div>
        ))}
      </div>

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

function InsertPoint({ onClick }: { onClick: () => void }) {
  return (
    <button className="insert-point" onClick={onClick}>
      <span className="insert-point-plus">+</span>
      Add track
    </button>
  );
}
