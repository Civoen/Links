import { useEffect, useState } from "react";
import logoUrl from "../assets/logo.png";

interface ReleaseNote {
  version: string;
  title: string;
  body: string;
  publishedAt: string;
}

function formatReleaseDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const MAX_RELEASES_SHOWN = 15;

export default function AboutPage() {
  const [releases, setReleases] = useState<ReleaseNote[] | null>(null);
  const [changelogError, setChangelogError] = useState<string | null>(null);

  useEffect(() => {
    window.linksAPI.getReleaseNotes().then((result) => {
      if (result.ok && result.releases) {
        setReleases(result.releases);
      } else {
        setChangelogError(result.error || "Couldn't load the changelog.");
      }
    });
  }, []);

  return (
    <div className="screen">
      <h1 className="page-title">About</h1>

      <div className="about-card">
        <img src={logoUrl} alt="" className="about-logo" />
        <p className="about-name">Links</p>
        <p className="about-tagline">Keep tracks together, even on shuffle.</p>

        <p className="about-disclaimer">
          Links is an independent, unofficial project. It is not affiliated
          with, endorsed by, or sponsored by Spotify AB. Spotify is a
          trademark of Spotify AB.
        </p>

        <a className="btn" href="https://github.com/Civoen/Links" target="_blank" rel="noreferrer">
          View on GitHub
        </a>
      </div>

      <div className="settings-section" style={{ marginTop: 24 }}>
        <p className="settings-section-title">Support Links</p>
        <div className="support-card">
          <div className="support-card-top">
            <div className="support-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <div className="support-card-body">
              <p className="support-card-title">Enjoying Links?</p>
              <p className="support-card-text">
                Links is free and always will be. If it's saved you from shuffle chaos, buying a White Monster helps keep it going.
              </p>
            </div>
          </div>
          <a
            className="btn btn-primary support-card-btn"
            href="https://www.buymeacoffee.com/YOUR_USERNAME"
            target="_blank"
            rel="noreferrer"
          >
            Buy Me a White Monster
          </a>
        </div>
      </div>

      <div className="settings-section" style={{ marginTop: 24 }}>
        <p className="settings-section-title">Changelog</p>

        {releases === null && !changelogError && <p className="muted">Loading…</p>}

        {changelogError && <p className="settings-row-hint">{changelogError}</p>}

        {releases !== null && releases.length === 0 && (
          <p className="settings-row-hint">No releases published yet.</p>
        )}

        {releases !== null && releases.length > 0 && (
          <div className="changelog-list">
            {releases.slice(0, MAX_RELEASES_SHOWN).map((release, i) => (
              <div className="changelog-entry" key={release.version || i}>
                <div className="changelog-entry-header">
                  <span className="changelog-version">{release.version}</span>
                  <span className="changelog-title">{release.title}</span>
                  {release.publishedAt && (
                    <span className="changelog-date">{formatReleaseDate(release.publishedAt)}</span>
                  )}
                </div>
                {release.body && <p className="changelog-body">{release.body}</p>}
              </div>
            ))}
          </div>
        )}

        <a
          className="changelog-view-all"
          href="https://github.com/Civoen/Links/releases"
          target="_blank"
          rel="noreferrer"
        >
          View full release history on GitHub
        </a>
      </div>
    </div>
  );
}
