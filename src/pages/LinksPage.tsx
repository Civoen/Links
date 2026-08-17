import { useEffect, useState } from "react";
import type { Link } from "../../electron/linkStore";
import logoUrl from "../assets/logo.png";
import LinkGlyph from "../components/LinkGlyph";

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
          <img className="brand-icon" src={logoUrl} alt="" />
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

            <button
              className="icon-btn link-delete-btn"
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
