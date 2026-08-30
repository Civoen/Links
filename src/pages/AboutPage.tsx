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
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);

  useEffect(() => {
    window.linksAPI.getReleaseNotes().then((result) => {
      if (result.ok && result.releases) {
        setReleases(result.releases);
        if (result.releases.length > 0) setExpandedVersion(result.releases[0].version);
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
      </div>

      <a className="link-row" href="https://github.com/Civoen/Links" target="_blank" rel="noreferrer">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.833.092-.647.35-1.088.636-1.338-2.221-.253-4.556-1.113-4.556-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z"/></svg>
        <span>View source on GitHub</span>
        <svg className="link-row-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M7 7h10v10"/></svg>
      </a>

      <a className="link-row" href="https://discord.gg/JeA3YjTYhf" target="_blank" rel="noreferrer">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026 13.83 13.83 0 0 0 1.226-1.963.074.074 0 0 0-.041-.104 13.201 13.201 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.246.195.373.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028ZM8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38 0-1.312.956-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.311-.956 2.38-2.157 2.38Zm7.975 0c-1.183 0-2.157-1.069-2.157-2.38 0-1.312.955-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.311-.946 2.38-2.157 2.38Z"/></svg>
        <span>Join our Discord</span>
        <svg className="link-row-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M7 7h10v10"/></svg>
      </a>

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
            href="https://ko-fi.com/linksapp"
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
            {releases.slice(0, MAX_RELEASES_SHOWN).map((release, i) => {
              const key = release.version || String(i);
              const isExpanded = expandedVersion === key;
              return (
                <div className="changelog-entry" key={key}>
                  <button
                    className="changelog-entry-header"
                    onClick={() => setExpandedVersion(isExpanded ? null : key)}
                    aria-expanded={isExpanded}
                  >
                    <svg
                      className={`changelog-chevron${isExpanded ? " changelog-chevron-open" : ""}`}
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <span className="changelog-version">{release.version}</span>
                    <span className="changelog-title">{release.title}</span>
                    {release.publishedAt && (
                      <span className="changelog-date">{formatReleaseDate(release.publishedAt)}</span>
                    )}
                  </button>
                  <div className={`changelog-body-wrapper${isExpanded ? " expanded" : ""}`}>
                    {release.body && <p className="changelog-body">{release.body}</p>}
                  </div>
                </div>
              );
            })}
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
