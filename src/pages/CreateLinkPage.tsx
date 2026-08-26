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
  onSaved,
  onCancel
}: {
  editingLink?: Link;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [tracks, setTracks] = useState<TrackSummary[]>(editingLink?.tracks ?? []);
  const [titleInput, setTitleInput] = useState(editingLink?.title ?? "");
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<Link | null>(null);

  // Discover's detection lives here now instead of a separate page — the
  // moment a track is added, Links quietly checks whether it has a likely
  // sibling (same album adjacent position, or a matching "Part 2"/roman
  // numeral pattern) and offers to add it right where you're already
  // working, rather than requiring a trip to scan a whole playlist.
  const [siblingSuggestions, setSiblingSuggestions] = useState<TrackSummary[]>([]);
  const [dismissedSiblingUris, setDismissedSiblingUris] = useState<Set<string>>(new Set());

  async function checkForSiblings(track: TrackSummary) {
    try {
      const siblings = await window.linksAPI.findSiblingTracks(track);
      setSiblingSuggestions((current) => {
        const existingUris = new Set(current.map((t) => t.uri));
        const newOnes = siblings.filter((s) => !existingUris.has(s.uri));
        return [...current, ...newOnes];
      });
    } catch (err) {
      // Non-critical — a missed suggestion isn't worth surfacing an error for.
      console.error("[CreateLinkPage] sibling check failed:", err);
    }
  }

  function openSearchAt(index: number) {
    setError(null);
    setInsertAt(index);
  }

  function handlePick(track: TrackSummary) {
    if (insertAt === null) return;
    if (tracks.some((t) => t.uri === track.uri)) {
      setError(`"${track.name}" is already in this chain.`);
      setInsertAt(null);
      return;
    }
    setTracks((current) => {
      const next = [...current];
      next.splice(insertAt, 0, track);
      return next;
    });
    setInsertAt(null);
    setDuplicateWarning(null);
    checkForSiblings(track);
  }

  function handleAddSuggestion(track: TrackSummary) {
    if (tracks.some((t) => t.uri === track.uri)) return; // shouldn't happen — suggestions are already filtered — but never add a duplicate regardless
    setTracks((current) => [...current, track]);
    setDuplicateWarning(null);
    checkForSiblings(track); // cascades — this track might have its own further siblings
  }

  function handleDismissSuggestion(uri: string) {
    setDismissedSiblingUris((current) => new Set(current).add(uri));
  }

  function handleRemove(index: number) {
    setTracks((current) => current.filter((_, i) => i !== index));
    setDuplicateWarning(null);
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
    setDuplicateWarning(null);
  }

  async function performSave() {
    setSaving(true);
    try {
      if (editingLink) {
        await window.linksAPI.updateLink(editingLink.id, tracks, titleInput);
      } else {
        await window.linksAPI.saveLink(tracks, titleInput);
      }
      onSaved();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Couldn't save this link. Try again.");
      setSaving(false);
    }
  }

  async function handleSave() {
    if (tracks.length < 2) {
      setError("Add at least two tracks to create a link.");
      return;
    }
    setError(null);

    const duplicate = await window.linksAPI.findDuplicateLink(tracks, editingLink?.id);
    if (duplicate) {
      setDuplicateWarning(duplicate);
      return;
    }

    await performSave();
  }

  async function handleSaveAnyway() {
    setDuplicateWarning(null);
    await performSave();
  }

  const pageTitle = editingLink ? "Edit link" : "Create a link";

  // Filtered at render time against the live chain and dismissals, rather
  // than when the background check started, so a suggestion never lingers
  // after its track gets added (via suggestion or manual search) or
  // dismissed.
  const visibleSuggestions = siblingSuggestions.filter(
    (s) => !tracks.some((t) => t.uri === s.uri) && !dismissedSiblingUris.has(s.uri)
  );

  if (insertAt !== null) {
    return (
      <div className="screen screen-narrow">
        <h1 className="page-title">{pageTitle}</h1>
        <TrackSearch onPick={handlePick} onClose={() => setInsertAt(null)} />
      </div>
    );
  }

  return (
    <div className="screen screen-narrow">
      <h1 className="page-title">{pageTitle}</h1>
      <p className="muted">
        Search for tracks, drag to reorder, and add more anywhere in the chain.
      </p>

      <label className="field-label" htmlFor="link-title-input">
        Title (optional)
      </label>
      <input
        id="link-title-input"
        className="search-input link-title-input"
        placeholder="Leave blank to name it automatically"
        value={titleInput}
        onChange={(e) => setTitleInput(e.target.value)}
      />

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

      {visibleSuggestions.length > 0 && (
        <div className="sibling-suggestions">
          <p className="sibling-suggestions-label">This might be part of a series</p>
          {visibleSuggestions.map((s) => (
            <div className="sibling-suggestion" key={s.uri}>
              {s.albumArt ? (
                <img className="track-thumb" src={s.albumArt} alt="" />
              ) : (
                <div className="track-thumb" />
              )}
              <div className="track-info">
                <p className="track-name">{s.name}</p>
                <p className="track-artist">{s.artist}</p>
              </div>
              <button className="btn btn-primary sibling-suggestion-add" onClick={() => handleAddSuggestion(s)}>
                Add
              </button>
              <button
                className="icon-btn"
                aria-label={`Dismiss ${s.name}`}
                onClick={() => handleDismissSuggestion(s.uri)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {duplicateWarning && (
        <div className="duplicate-warning">
          <p className="duplicate-warning-title">You already have this link</p>
          <p className="duplicate-warning-text">
            "{duplicateWarning.title || duplicateWarning.tracks[0].name}" has the exact same
            tracks in the same order. Save anyway if this is intentional.
          </p>
          <div className="button-row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => setDuplicateWarning(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSaveAnyway} disabled={saving}>
              {saving ? "Saving…" : "Save anyway"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      {!duplicateWarning && (
        <div className="button-row">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save link"}
          </button>
        </div>
      )}
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
