import { useEffect, useState } from "react";
import type { Link } from "../../electron/linkStore";

export default function LinksPage({ onCreateLink }: { onCreateLink: () => void }) {
  const [links, setLinks] = useState<Link[] | null>(null);

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    window.linksAPI.getLinks().then(setLinks);
  }

  async function handleDelete(id: string) {
    await window.linksAPI.deleteLink(id);
    refresh();
  }

  return (
    <div className="screen">
      <div className="page-header">
        <div className="brand">
          <span className="brand-icon" />
          <span className="brand-name">Links</span>
        </div>
        <button className="btn btn-primary" onClick={onCreateLink}>
          Create link
        </button>
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
        {links?.map((link) => (
          <div className="link-card" key={link.id}>
            <div>
              <div className="link-chain">
                {link.tracks.map((track, i) => (
                  <span key={track.uri} className="link-chain-item">
                    <span className="link-chain-name">{track.name}</span>
                    {i < link.tracks.length - 1 && <span className="link-chain-dot" />}
                  </span>
                ))}
              </div>
              <p className="link-meta">
                {link.tracks[0].artist} · {link.tracks.length} tracks
              </p>
            </div>
            <button
              className="icon-btn"
              aria-label={`Delete link: ${link.tracks.map((t) => t.name).join(" then ")}`}
              onClick={() => handleDelete(link.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
