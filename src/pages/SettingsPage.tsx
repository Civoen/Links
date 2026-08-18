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
  const [minimizeToTray, setMinimizeToTrayValue] = useState(true);
  const [showNotifications, setShowNotificationsValue] = useState(true);
  const [launchAtLogin, setLaunchAtLoginValue] = useState(false);
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.linksAPI.getClientId().then((id) => {
      setClientIdValue(id ?? "");
      setClientIdInput(id ?? "");
    });
    window.linksAPI.getMinimizeToTray().then(setMinimizeToTrayValue);
    window.linksAPI.getShowEngineNotifications().then(setShowNotificationsValue);
    window.linksAPI.getLaunchAtLogin().then(setLaunchAtLoginValue);
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

  async function handleToggleMinimizeToTray() {
    const next = !minimizeToTray;
    setMinimizeToTrayValue(next);
    try {
      await window.linksAPI.setMinimizeToTray(next);
    } catch {
      setMinimizeToTrayValue(!next);
      setError("Couldn't save that setting. Try again.");
    }
  }

  async function handleToggleShowNotifications() {
    const next = !showNotifications;
    setShowNotificationsValue(next);
    try {
      await window.linksAPI.setShowEngineNotifications(next);
    } catch {
      setShowNotificationsValue(!next);
      setError("Couldn't save that setting. Try again.");
    }
  }

  async function handleToggleLaunchAtLogin() {
    const next = !launchAtLogin;
    setLaunchAtLoginValue(next);
    try {
      await window.linksAPI.setLaunchAtLogin(next);
    } catch {
      setLaunchAtLoginValue(!next);
      setError("Couldn't save that setting. Try again.");
    }
  }

  async function handleExportLinks() {
    setExportStatus(null);
    try {
      const result = await window.linksAPI.exportLinks();
      setExportStatus(result.ok ? `Saved to ${result.filePath}` : null);
    } catch {
      setExportStatus("Couldn't export. Try again.");
    }
  }

  async function handleClearAll() {
    setClearing(true);
    try {
      await window.linksAPI.clearAllLinks();
      setConfirmingClearAll(false);
    } catch {
      setError("Couldn't clear your links. Try again.");
    } finally {
      setClearing(false);
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
        <p className="settings-section-title">Window behavior</p>
        <div className="settings-row">
          <div>
            <p className="settings-row-label">
              {minimizeToTray ? "Keep running when closed" : "Quit when closed"}
            </p>
            <p className="settings-row-hint">
              {minimizeToTray
                ? "Closing the window minimizes Links to the system tray, and your links keep working. Choose Quit from the tray icon to close it fully."
                : "Closing the window quits Links entirely, and it stops keeping your tracks together until you reopen it."}
            </p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={minimizeToTray}
              onChange={handleToggleMinimizeToTray}
              aria-label="Keep Links running in the system tray when the window is closed"
            />
            <span className="toggle-switch-track" />
          </label>
        </div>
      </div>

      <div className="settings-section">
        <p className="settings-section-title">Startup</p>
        <div className="settings-row">
          <div>
            <p className="settings-row-label">Launch at login</p>
            <p className="settings-row-hint">
              Start Links automatically when you sign in, so it's already watching before you open Spotify.
            </p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={launchAtLogin}
              onChange={handleToggleLaunchAtLogin}
              aria-label="Launch Links automatically at login"
            />
            <span className="toggle-switch-track" />
          </label>
        </div>
      </div>

      <div className="settings-section">
        <p className="settings-section-title">Notifications</p>
        <div className="settings-row">
          <div>
            <p className="settings-row-label">Show queue notifications</p>
            <p className="settings-row-hint">
              A brief popup whenever Links adds a track to your queue or corrects the order.
            </p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={showNotifications}
              onChange={handleToggleShowNotifications}
              aria-label="Show a notification when Links adds a track to the queue"
            />
            <span className="toggle-switch-track" />
          </label>
        </div>
      </div>

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

      <div className="settings-section">
        <p className="settings-section-title">Your data</p>

        <div className="settings-row" style={{ marginBottom: 8 }}>
          <div>
            <p className="settings-row-label">Export your links</p>
            <p className="settings-row-hint">Save a backup file of every link you've created.</p>
          </div>
          <button className="btn" onClick={handleExportLinks}>
            Export
          </button>
        </div>
        {exportStatus && <p className="settings-row-hint" style={{ margin: "0 0 8px 4px" }}>{exportStatus}</p>}

        {!confirmingClearAll ? (
          <div className="settings-row">
            <div>
              <p className="settings-row-label">Clear all links</p>
              <p className="settings-row-hint">Permanently delete every link. This can't be undone.</p>
            </div>
            <button className="btn" onClick={() => setConfirmingClearAll(true)}>
              Clear all
            </button>
          </div>
        ) : (
          <div className="settings-row settings-row-danger">
            <div>
              <p className="settings-row-label">Delete every link?</p>
              <p className="settings-row-hint">
                This permanently removes all your links. Consider exporting a backup first.
              </p>
            </div>
            <div className="button-row" style={{ margin: 0 }}>
              <button className="btn" onClick={() => setConfirmingClearAll(false)} disabled={clearing}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleClearAll} disabled={clearing}>
                {clearing ? "Clearing…" : "Yes, clear everything"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <p className="settings-section-title">Support Links</p>
        <div className="support-card">
          <div className="support-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
              <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
              <line x1="6" y1="1" x2="6" y2="4" />
              <line x1="10" y1="1" x2="10" y2="4" />
              <line x1="14" y1="1" x2="14" y2="4" />
            </svg>
          </div>
          <div className="support-card-body">
            <p className="support-card-title">Enjoying Links?</p>
            <p className="support-card-text">
              Links is free and always will be. If it's saved you from shuffle chaos, buying a coffee helps keep it going.
            </p>
          </div>
          <a
            className="btn btn-primary support-card-btn"
            href="https://www.buymeacoffee.com/YOUR_USERNAME"
            target="_blank"
            rel="noreferrer"
          >
            Buy me a coffee
          </a>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
