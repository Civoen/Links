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
    </div>
  );
}
