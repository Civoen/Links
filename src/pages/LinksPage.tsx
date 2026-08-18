import { useEffect, useRef, useState } from "react";
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

/** "Artist — Collection" using the first track's artist/album, matching how a
 *  multi-part release is usually described. Falls back gracefully for older
 *  or manually-built links that might be missing album metadata. */
function linkTitle(link: Link): string {
  const first = link.tracks[0];
  return first.album ? `${first.artist} — ${first.album}` : first.artist;
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
  const pendingDelete = useRef<PendingDelete | null>(null);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<string | null>(null);

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    window.linksAPI.getLinks().then(setLinks);
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

  const linkCount = links?.length ?? 0;

  return (
    <div className="screen">
      <div className="list-header">
        <p className="list-header-count">{linkCount} active link{linkCount === 1 ? "" : "s"}</p>
        <div className="list-header-actions">
          <button className="btn btn-secondary" onClick={onCreateLink}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            Create link
          </button>
          <OverflowMenu
            ariaLabel="More actions"
            items={[{ label: "Scan a playlist for suggested links", onClick: onOpenDiscover }]}
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

      <div className="link-list">
        {links?.map((link) => {
          const isExpanded = expandedId === link.id;
          const cover = link.tracks[0].albumArt;

          return (
            <div className={`link-card${isExpanded ? " link-card-expanded" : ""}`} key={link.id}>
              <button
                className="link-card-summary"
                onClick={() => toggleExpanded(link.id)}
                aria-expanded={isExpanded}
              >
                {cover ? (
                  <img className="link-cover" src={cover} alt="" />
                ) : (
                  <div className="link-cover link-cover-empty" />
                )}

                <div className="link-card-body">
                  <p className="link-title">{linkTitle(link)}</p>
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

                <span className="active-badge">Active</span>

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
        <>
          <div className="list-footnote">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            Links only adds to your queue. It never skips or removes songs.
          </div>
          <p className="status-line">
            <span className="status-dot" />
            Watching {linkCount} link{linkCount === 1 ? "" : "s"} for shuffle
          </p>
        </>
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
