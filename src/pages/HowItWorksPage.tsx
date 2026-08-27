import LinkGlyph from "../components/LinkGlyph";
import logoUrl from "../assets/logo.png";
import theIslandCoverUrl from "../assets/the-island-cover.jpg";

export default function HowItWorksPage({ onCreateLink }: { onCreateLink: () => void }) {
  return (
    <div className="screen screen-narrow">
      <div className="howitworks-header">
        <img src={logoUrl} alt="" className="howitworks-logo" />
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>
            How Links works
          </h1>
          <p className="muted" style={{ margin: "2px 0 0" }}>
            Keep the tracks you choose playing together, even on shuffle.
          </p>
        </div>
      </div>

      <div className="howitworks-compare">
        <div className="howitworks-panel">
          <p className="howitworks-panel-label">Shuffle alone</p>
          <div className="howitworks-row howitworks-row-muted">
            <span className="howitworks-swatch" style={{ background: "#3a3a3a" }} />
            Other song
          </div>
          <div className="howitworks-row">
            <img className="howitworks-swatch" src={theIslandCoverUrl} alt="" />
            The Island, Pt. II
          </div>
          <div className="howitworks-row howitworks-row-muted">
            <span className="howitworks-swatch" style={{ background: "#2f4a3a" }} />
            Other song
          </div>
          <div className="howitworks-row">
            <img className="howitworks-swatch" src={theIslandCoverUrl} alt="" />
            The Island, Pt. I
          </div>
        </div>

        <div className="howitworks-panel howitworks-panel-good">
          <p className="howitworks-panel-label howitworks-panel-label-good">With Links</p>
          <div className="howitworks-row howitworks-row-muted">
            <span className="howitworks-swatch" style={{ background: "#3a3a3a" }} />
            Other song
          </div>
          <div className="howitworks-group">
            <div className="howitworks-row">
              <img className="howitworks-swatch" src={theIslandCoverUrl} alt="" />
              The Island, Pt. I
            </div>
            <div className="howitworks-row">
              <img className="howitworks-swatch" src={theIslandCoverUrl} alt="" />
              The Island, Pt. II
            </div>
          </div>
          <div className="howitworks-row howitworks-row-muted">
            <span className="howitworks-swatch" style={{ background: "#2f4a3a" }} />
            Other song
          </div>
        </div>
      </div>
      <p className="howitworks-compare-caption">
        Everything else keeps shuffling exactly as normal, only the tracks you actually link stay together.
      </p>

      <div className="howitworks-steps">
        <div className="howitworks-step">
          <span className="howitworks-step-number">1</span>
          <div>
            <p className="howitworks-step-title">Create a link</p>
            <p className="howitworks-step-body">
              Search for the tracks that belong together, in the order you want them to play. Links will
              often suggest the next part automatically as you go.
            </p>
          </div>
        </div>

        <div className="howitworks-step">
          <span className="howitworks-step-number">2</span>
          <div>
            <p className="howitworks-step-title">Keep shuffle on</p>
            <p className="howitworks-step-body">
              Listen exactly like you normally do, nothing else about your Spotify changes.
            </p>
          </div>
        </div>

        <div className="howitworks-step">
          <span className="howitworks-step-number">3</span>
          <div>
            <p className="howitworks-step-title">Links takes care of the rest</p>
            <p className="howitworks-step-body">
              The moment the first track in a link starts playing, from anywhere, the rest of the chain
              gets queued right after it.
            </p>
          </div>
        </div>
      </div>

      <div className="howitworks-promise">
        <LinkGlyph size={16} />
        <p>
          Links only ever adds to your queue. It never skips, removes, or reorders anything Spotify
          controls directly.
        </p>
      </div>

      <button className="btn btn-primary" onClick={onCreateLink}>
        Create A Link
      </button>
    </div>
  );
}
