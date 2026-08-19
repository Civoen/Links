import { useEffect, useMemo, useRef, useState } from "react";
import type { Link } from "../../electron/linkStore";
import LinkGlyph from "../components/LinkGlyph";
import Toast from "../components/Toast";
import OverflowMenu from "../components/OverflowMenu";

function formatDuration(ms?: number): string {
  if (!ms) return "";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** The user's own title if they gave one, otherwise "Artist · Collection"
 *  using the first track's artist/album — a reasonable auto-generated name
 *  for the common case where a link is one release's sequential tracks. */
function linkTitle(link: Link): string {
  if (link.title) return link.title;
  const first = link.tracks[0];
  return first.album ? `${first.artist} · ${first.album}` : first.artist;
}

/** Every distinct, non-empty album art URL across a link's tracks. */
function uniqueCovers(link: Link): string[] {
  const seen = new Set<string>();
  for (const track of link.tracks) {
    if (track.albumArt) seen.add(track.albumArt);
  }
  return [...seen];
}

function matchesSearch(link: Link, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (linkTitle(link).toLowerCase().includes(q)) return true;
  return link.tracks.some(
    (t) => t.name.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
  );
}

interface PendingDelete {
  link: Link;
  index: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

export default function LinksPage({
  onCreateLink,
  onEditLink,
  onOpenDiscover
}: {
  onCreateLink: () => void;
  onEditLink: (link: Link) => void;
  onOpenDiscover: () => void;
}) {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [brokenUris, setBrokenUris] = useState<Set<string>>(new Set());
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const pendingDelete = useRef<PendingDelete | null>(null);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    window.linksAPI.getBrokenTrackUris().then((uris) => setBrokenUris(new Set(uris)));
  }, []);

  function refresh() {
    window.linksAPI.getLinks().then(setLinks);
  }

  function handleRecheckBroken() {
    window.linksAPI.recheckBrokenTrackUris().then((uris) => setBrokenUris(new Set(uris)));
  }

  async function handleToggleActive(link: Link) {
    const next = !link.active;
    setLinks((current) =>
      current ? current.map((l) => (l.id === link.id ? { ...l, active: next } : l)) : current
    );
    try {
      await window.linksAPI.setLinkActive(link.id, next);
    } catch {
      setLinks((current) =>
        current ? current.map((l) => (l.id === link.id ? { ...l, active: !next } : l)) : current
      );
    }
  }

  function handleDelete(link: Link) {
    if (pendingDelete.current) finalizePendingDelete();

    const index = links?.findIndex((l) => l.id === link.id) ?? -1;
    setLinks((current) => (current ? current.filter((l) => l.id !== link.id) : current));

    const timeoutId = setTimeout(() => {
      window.linksAPI.deleteLink(link.id);
      pendingDelete.current = null;
      setPendingDeleteMessage(null);
    }, 5000);

    pendingDelete.current = { link, index, timeoutId };
    setPendingDeleteMessage(`Deleted "${linkTitle(link)}" link`);
  }

  function finalizePendingDelete() {
    if (!pendingDelete.current) return;
    clearTimeout(pendingDelete.current.timeoutId);
    window.linksAPI.deleteLink(pendingDelete.current.link.id);
    pendingDelete.current = null;
  }

  function handleUndoDelete() {
    if (!pendingDelete.current) return;
    clearTimeout(pendingDelete.current.timeoutId);
    const { link, index } = pendingDelete.current;
    pendingDelete.current = null;
    setPendingDeleteMessage(null);
    setLinks((current) => {
      if (!current) return current;
      const next = [...current];
      next.splice(Math.max(0, index), 0, link);
      return next;
    });
  }

  function toggleExpanded(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

  function handleDrop(targetId: string) {
    if (!links || !draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const draggedIndex = links.findIndex((l) => l.id === draggedId);
    const targetIndex = links.findIndex((l) => l.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const reordered = [...links];
    const [moved] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    setLinks(reordered);
    setDraggedId(null);
    setDragOverId(null);
    window.linksAPI.reorderLinks(reordered.map((l) => l.id)).catch((err) => {
      console.error("Couldn't save the new link order:", err);
    });
  }

  const linkCount = links?.length ?? 0;
  const isSearching = searchQuery.trim().length > 0;
  const filteredLinks = useMemo(
    () => (links ?? []).filter((link) => matchesSearch(link, searchQuery)),
    [links, searchQuery]
  );

  return (
    <div className="screen">
      <div className="list-header">
        <p className="list-header-count">{linkCount} link{linkCount === 1 ? "" : "s"}</p>
        <div className="list-header-actions">
          <button className="btn btn-secondary" onClick={onCreateLink}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            Create link
          </button>
          <OverflowMenu
            ariaLabel="More actions"
            items={[
              { label: "Scan a playlist for suggested links", onClick: onOpenDiscover },
              { label: "Recheck for broken links", onClick: handleRecheckBroken }
            ]}
          />
        </div>
      </div>

      {links === null && <p className="muted">Loading your links…</p>}

      {links !== null && links.length === 0 && (
        <div className="empty-state">
          <p className="empty-title">No links yet</p>
          <p className="empty-body">
            Create one to keep two or more tracks playing in order, even on shuffle.
          </p>
          <button className="btn btn-primary" onClick={onCreateLink}>
            Create your first link
          </button>
        </div>
      )}

      {links !== null && links.length > 0 && (
        <div className="search-input-wrap" style={{ margin: "0 0 14px" }}>
          <input
            type="text"
            className="search-input"
            placeholder="Search your links"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      )}

      {links !== null && links.length > 0 && filteredLinks.length === 0 && (
        <p className="muted">No links match "{searchQuery}".</p>
      )}

      <div className="link-list">
        {filteredLinks.map((link) => {
          const isExpanded = expandedId === link.id;
          const covers = uniqueCovers(link);
          const hasBrokenTrack = link.tracks.some((t) => brokenUris.has(t.uri));
          const brokenCount = link.tracks.filter((t) => brokenUris.has(t.uri)).length;
          const isDraggable = !isSearching;

          return (
            <div
              className={`link-card${isExpanded ? " link-card-expanded" : ""}${dragOverId === link.id ? " link-card-drop-target" : ""}${!link.active ? " link-card-paused" : ""}`}
              key={link.id}
              draggable={isDraggable}
              onDragStart={() => isDraggable && setDraggedId(link.id)}
              onDragOver={(e) => {
                if (!isDraggable) return;
                e.preventDefault();
                setDragOverId(link.id);
              }}
              onDragLeave={() => setDragOverId((current) => (current === link.id ? null : current))}
              onDrop={() => isDraggable && handleDrop(link.id)}
              onDragEnd={() => {
                setDraggedId(null);
                setDragOverId(null);
              }}
            >
              <button
                className="link-card-summary"
                onClick={() => toggleExpanded(link.id)}
                aria-expanded={isExpanded}
              >
                {isDraggable && (
                  <span className="drag-handle link-drag-handle" aria-hidden="true">
                    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
                      <circle cx="2" cy="2" r="1.5" /><circle cx="8" cy="2" r="1.5" />
                      <circle cx="2" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" />
                      <circle cx="2" cy="14" r="1.5" /><circle cx="8" cy="14" r="1.5" />
                    </svg>
                  </span>
                )}

                {covers.length >= 2 ? (
                  <span className="link-cover-stack">
                    <img className="link-cover-back" src={covers[1]} alt="" />
                    <img className="link-cover-front" src={covers[0]} alt="" />
                  </span>
                ) : covers.length === 1 ? (
                  <img className="link-cover" src={covers[0]} alt="" />
                ) : (
                  <div className="link-cover link-cover-empty" />
                )}

                <div className="link-card-body">
                  <p className="link-title">
                    {linkTitle(link)}
                    {hasBrokenTrack && (
                      <span
                        className="broken-indicator"
                        title={`${brokenCount} track${brokenCount === 1 ? "" : "s"} no longer available on Spotify`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                      </span>
                    )}
                  </p>
                  <p className="link-subtitle">
                    {link.tracks.map((track, i) => (
                      <span className="link-track-name-part" key={track.uri + i}>
                        {track.name}
                        {i < link.tracks.length - 1 && (
                          <span className="link-track-name-glyph">
                            <LinkGlyph size={10} />
                          </span>
                        )}
                      </span>
                    ))}
                  </p>
                </div>

                <button
                  className={`active-badge${link.active ? "" : " paused"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleActive(link);
                  }}
                  aria-label={link.active ? `Pause ${linkTitle(link)}` : `Activate ${linkTitle(link)}`}
                >
                  {link.active ? "Active" : "Paused"}
                </button>

                <span onClick={(e) => e.stopPropagation()}>
                  <OverflowMenu
                    ariaLabel={`More actions for ${linkTitle(link)}`}
                    items={[
                      { label: "Edit", onClick: () => onEditLink(link) },
                      { label: "Delete", onClick: () => handleDelete(link), danger: true }
                    ]}
                  />
                </span>
              </button>

              {isExpanded && (
                <div className="link-card-expanded-list">
                  {link.tracks.map((track, i) => (
                    <div className="expanded-track-row" key={track.uri + i}>
                      <span className="expanded-track-number">{i + 1}</span>
                      {track.albumArt ? (
                        <img className="track-thumb" src={track.albumArt} alt="" />
                      ) : (
                        <div className="track-thumb" />
                      )}
                      <div className="track-info">
                        <p className="track-name">
                          {track.name}
                          {brokenUris.has(track.uri) && (
                            <span className="broken-indicator" title="No longer available on Spotify">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                <line x1="12" y1="9" x2="12" y2="13" />
                                <line x1="12" y1="17" x2="12.01" y2="17" />
                              </svg>
                            </span>
                          )}
                        </p>
                        <p className="track-artist">{track.artist}</p>
                      </div>
                      {track.durationMs && (
                        <span className="track-duration">{formatDuration(track.durationMs)}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {links !== null && links.length > 0 && (
        <p className="status-line">
          <span className="status-dot" />
          Watching {links.filter((l) => l.active).length} link{links.filter((l) => l.active).length === 1 ? "" : "s"} for shuffle
        </p>
      )}

      {pendingDeleteMessage && (
        <Toast
          message={pendingDeleteMessage}
          actionLabel="Undo"
          onAction={handleUndoDelete}
          onDismiss={() => {
            finalizePendingDelete();
            setPendingDeleteMessage(null);
          }}
          durationMs={5000}
        />
      )}
    </div>
  );
}
