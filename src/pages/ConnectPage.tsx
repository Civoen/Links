import { useEffect, useState } from "react";
import logoUrl from "../assets/logo.png";

type Step = "loading" | "needsClientId" | "readyToConnect";

export default function ConnectPage({ onConnected }: { onConnected: () => void }) {
  const [step, setStep] = useState<Step>("loading");
  const [clientIdInput, setClientIdInput] = useState("");
  const [savingClientId, setSavingClientId] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.linksAPI.getClientId().then((id) => {
      setStep(id ? "readyToConnect" : "needsClientId");
    });
  }, []);

  async function handleSaveClientId() {
    if (!clientIdInput.trim()) {
      setError("Paste in your Client ID first.");
      return;
    }
    setSavingClientId(true);
    setError(null);
    try {
      await window.linksAPI.setClientId(clientIdInput.trim());
      setStep("readyToConnect");
    } catch {
      setError("Couldn't save that Client ID. Try again.");
    } finally {
      setSavingClientId(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      // Opens the system browser; App.tsx picks up the "auth:updated" event
      // once the OS hands the OAuth redirect back to the main process.
      await window.linksAPI.startAuth();
    } catch (err) {
      console.error(err);
      setError("Couldn't start the Spotify sign-in. Try again.");
      setConnecting(false);
    }
  }

  if (step === "loading") return null;

  if (step === "needsClientId") {
    return (
      <div className="screen screen-centered">
        <div className="connect-card">
          <img className="connect-icon" src={logoUrl} alt="" />

          <h1 className="connect-title">Set up your own Spotify app</h1>
          <p className="connect-body">
            Spotify requires every app to connect through its own developer
            registration, so Links asks you to create a free one — it takes
            about a minute and it's just for you.
          </p>

          <ol className="connect-steps">
            <li>
              Open the{" "}
              <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
                Spotify Developer dashboard
              </a>{" "}
              and create an app.
            </li>
            <li>
              In its settings, add <code>links://callback</code> as a Redirect URI.
            </li>
            <li>Copy the Client ID it gives you and paste it below.</li>
          </ol>

          <input
            className="search-input client-id-input"
            placeholder="Paste your Spotify Client ID"
            value={clientIdInput}
            onChange={(e) => setClientIdInput(e.target.value)}
          />

          {error && <p className="error-text">{error}</p>}

          <button
            className="btn btn-primary btn-block"
            onClick={handleSaveClientId}
            disabled={savingClientId}
          >
            {savingClientId ? "Saving…" : "Continue"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen screen-centered">
      <div className="connect-card">
        <img className="connect-icon" src={logoUrl} alt="" />

        <h1 className="connect-title">Connect your Spotify account</h1>
        <p className="connect-body">
          Links needs permission to see what's playing and manage your queue,
          so linked tracks stay together during shuffle.
        </p>

        <ul className="connect-permissions">
          <li>See what's currently playing</li>
          <li>Add tracks to your queue</li>
          <li>Links never deletes, reorders, or plays anything on its own</li>
        </ul>

        {error && <p className="error-text">{error}</p>}

        <button className="btn btn-primary btn-block" onClick={handleConnect} disabled={connecting}>
          {connecting ? "Waiting for Spotify…" : "Connect with Spotify"}
        </button>

        <p className="connect-footnote">Requires a Spotify Premium account.</p>
      </div>
    </div>
  );
}
