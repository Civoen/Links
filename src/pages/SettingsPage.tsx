import { useEffect, useState } from "react";

export default function SettingsPage({
  onDisconnected
}: {
  onDisconnected: () => void;
}) {
  const [clientId, setClientIdValue] = useState("");
  const [clientIdInput, setClientIdInput] = useState("");
  const [editingClientId, setEditingClientId] = useState(false);
  const [savingClientId, setSavingClientId] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.linksAPI.getClientId().then((id) => {
      setClientIdValue(id ?? "");
      setClientIdInput(id ?? "");
    });
  }, []);

  async function handleSaveClientId() {
    if (!clientIdInput.trim()) {
      setError("Client ID can't be empty.");
      return;
    }
    setError(null);
    setSavingClientId(true);
    try {
      await window.linksAPI.setClientId(clientIdInput.trim());
      setClientIdValue(clientIdInput.trim());
      setEditingClientId(false);
    } catch {
      setError("Couldn't save that Client ID. Try again.");
    } finally {
      setSavingClientId(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await window.linksAPI.disconnect();
      onDisconnected();
    } catch {
      setError("Couldn't disconnect. Try again.");
      setDisconnecting(false);
    }
  }

  function maskClientId(id: string): string {
    if (id.length <= 8) return id;
    return `${id.slice(0, 4)}${"•".repeat(8)}${id.slice(-4)}`;
  }

  return (
    <div className="screen screen-narrow">
      <h1 className="page-title">Settings</h1>

      <div className="settings-section">
        <p className="settings-section-title">Spotify account</p>
        <div className="settings-row">
          <div>
            <p className="settings-row-label">Connected</p>
            <p className="settings-row-hint">
              Links can see what's playing and manage your queue.
            </p>
          </div>
          <button className="btn" onClick={handleDisconnect} disabled={disconnecting}>
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <p className="settings-section-title">Spotify app credentials</p>
        {!editingClientId ? (
          <div className="settings-row">
            <div>
              <p className="settings-row-label">Client ID</p>
              <p className="settings-row-hint">{maskClientId(clientId)}</p>
            </div>
            <button className="btn" onClick={() => setEditingClientId(true)}>
              Change
            </button>
          </div>
        ) : (
          <div>
            <input
              className="search-input client-id-input"
              value={clientIdInput}
              onChange={(e) => setClientIdInput(e.target.value)}
              autoFocus
            />
            <div className="button-row">
              <button
                className="btn"
                onClick={() => {
                  setClientIdInput(clientId);
                  setEditingClientId(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSaveClientId} disabled={savingClientId}>
                {savingClientId ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
