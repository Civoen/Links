import logoUrl from "../assets/logo.png";

export default function AboutPage() {
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
    </div>
  );
}
