import { useEffect, useRef, useState } from "react";
import type { Link } from "../../electron/linkStore";
import logoUrl from "../assets/logo.png";
import LinkGlyph from "../components/LinkGlyph";
import Toast from "../components/Toast";

function formatDuration(ms?: number): string {
  if (!ms) return "";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

interface PendingDelete {
  link: Link;
  index: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

export default function LinksPage({
  onCreateLink,
  onEditLink,
  onOpenSettings,
  onOpenSuggestions
}: {
  onCreateLink: () => void;
  onEditLink: (link: Link) => void;
  onOpenSettings: () => void;
  onOpenSuggestions: () => void;
}) {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pendingDelete = useRef<PendingDelete | null>(null);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<string | null>(null);

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    window.linksAPI.getLinks().then(setLinks);
  }

  function handleDelete(link: Link) {
    // Optimistically remove it from view immediately, but hold off on the
    // actual backend delete for a few seconds in case of Undo — nothing
    // is really gone until the timer below fires.
    if (pendingDelete.current) finalizePendingDelete();

    const index = links?.findIndex((l) => l.id === link.id) ?? -1;
    setLinks((current) => (current ? current.filter((l) => l.id !== link.id) : current));

    const timeoutId = setTimeout(() => {
      window.linksAPI.deleteLink(link.id);
      pendingDelete.current = null;
      setPendingDeleteMessage(null);
    }, 5000);

    pendingDelete.current = { link, index, timeoutId };
    setPendingDeleteMessage(`Deleted "${link.tracks[0].name}" link`);
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

  const linkCount = links?.length ?? 0;

  return (
    <div className="screen">
      <div className="page-header">
        <div className="brand">
          <img className="brand-icon" src={logoUrl} alt="" />
          <span className="brand-name">Links</span>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={onCreateLink}>
            Create link
          </button>
          <button className="icon-btn" aria-label="Suggested links" onClick={onOpenSuggestions}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v2M12 19v2M5 5l1.5 1.5M17.5 17.5L19 19M3 12h2M19 12h2M5 19l1.5-1.5M17.5 6.5L19 5" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          <button className="icon-btn" aria-label="Settings" onClick={onOpenSettings}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
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

      <div className="link-list">
        {links?.map((link) => {
          const isExpanded = expandedId === link.id;

          return (
            <div className={`link-card${isExpanded ? " link-card-expanded" : ""}`} key={link.id}>
              <button
                className="link-card-summary"
                onClick={() => toggleExpanded(link.id)}
                aria-expanded={isExpanded}
              >
                <div className="link-chain-thumbs">
                  {link.tracks.map((track, i) => (
                    <div className="link-chain-thumb-wrap" key={track.uri + i}>
                      {track.albumArt ? (
                        <img className="link-chain-thumb" src={track.albumArt} alt={track.name} />
                      ) : (
                        <div className="link-chain-thumb link-chain-thumb-empty" title={track.name} />
                      )}
                      {i < link.tracks.length - 1 && (
                        <span className="link-chain-connector">
                          <LinkGlyph size={11} />
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                <div className="link-card-body">
                  <p className="link-track-names">
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
                  <p className="link-meta">
                    {link.tracks[0].artist} · {link.tracks.length} tracks
                  </p>
                </div>

                <span className="link-card-actions">
                  <span
                    className="icon-btn"
                    role="button"
                    tabIndex={0}
                    aria-label={`Edit link: ${link.tracks.map((t) => t.name).join(" then ")}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditLink(link);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        onEditLink(link);
                      }
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </span>
                  <span
                    className="icon-btn"
                    role="button"
                    tabIndex={0}
                    aria-label={`Delete link: ${link.tracks.map((t) => t.name).join(" then ")}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(link);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        handleDelete(link);
                      }
                    }}
                  >
                    ✕
                  </span>
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
                        <p className="track-name">{track.name}</p>
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
          Watching {linkCount} link{linkCount === 1 ? "" : "s"} for shuffle
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
