import { useEffect, useState } from "react";
import type { UpdateStatus } from "../../electron/preload";
import type { ConnectionHealth } from "../../electron/spotifyApi";

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
  const [launchToTray, setLaunchToTrayValue] = useState(false);
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: "idle", update: null });
  const [showPatchNotes, setShowPatchNotes] = useState(false);
  const [connectionHealth, setConnectionHealth] = useState<ConnectionHealth>({ ok: true });
  const [checkingConnection, setCheckingConnection] = useState(false);

  useEffect(() => {
    window.linksAPI.getClientId().then((id) => {
      setClientIdValue(id ?? "");
      setClientIdInput(id ?? "");
    });
    window.linksAPI.getMinimizeToTray().then(setMinimizeToTrayValue);
    window.linksAPI.getShowEngineNotifications().then(setShowNotificationsValue);
    window.linksAPI.getLaunchAtLogin().then(setLaunchAtLoginValue);
    window.linksAPI.getLaunchToTray().then(setLaunchToTrayValue);
    window.linksAPI.getAppVersion().then(setAppVersion);
    window.linksAPI.getUpdateStatus().then(setUpdateStatus);
    window.linksAPI.getConnectionHealth().then(setConnectionHealth);

    return window.linksAPI.onUpdateStatus(setUpdateStatus);
  }, []);

  async function handleCheckConnection() {
    setCheckingConnection(true);
    try {
      const health = await window.linksAPI.checkConnectionNow();
      setConnectionHealth(health);
    } finally {
      setCheckingConnection(false);
    }
  }

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

  async function handleToggleLaunchToTray() {
    const next = !launchToTray;
    setLaunchToTrayValue(next);
    try {
      await window.linksAPI.setLaunchToTray(next);
    } catch {
      setLaunchToTrayValue(!next);
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

  async function handleImportLinks() {
    setExportStatus(null);
    try {
      const outcome = await window.linksAPI.importLinks();
      if (!outcome.ok) {
        if (outcome.error) setExportStatus(outcome.error);
        return; // canceled, or a silent no-op — nothing to report
      }
      const { imported, skippedDuplicates, skippedInvalid } = outcome.result!;
      const parts = [`Imported ${imported} link${imported === 1 ? "" : "s"}`];
      if (skippedDuplicates > 0) parts.push(`${skippedDuplicates} already saved, skipped`);
      if (skippedInvalid > 0) parts.push(`${skippedInvalid} couldn't be read`);
      if (outcome.settingsImported) parts.push("settings applied");
      setExportStatus(parts.join(" · "));
    } catch {
      setExportStatus("Couldn't import that file. Try again.");
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

  async function handleCheckForUpdates() {
    const result = await window.linksAPI.checkForUpdatesNow();
    if (!result.ok && result.reason) setError(result.reason);
  }

  function maskClientId(id: string): string {
    if (id.length <= 8) return id;
    return `${id.slice(0, 4)}${"•".repeat(8)}${id.slice(-4)}`;
  }

  function updateStatusLabel(): string {
    switch (updateStatus.status) {
      case "checking":
        return "Checking for updates…";
      case "downloading":
        return `Downloading version ${updateStatus.update?.version}…`;
      case "downloaded":
        return `Version ${updateStatus.update?.version} is ready to install`;
      case "error":
        return "Couldn't check for updates";
      default:
        return "You're up to date";
    }
  }

  return (
    <div className="screen screen-narrow">
      <h1 className="page-title">Settings</h1>

      <div className="settings-section">
        <p className="settings-section-title">Updates</p>

        {updateStatus.status === "downloaded" ? (
          <div className="update-ready-card">
            <p className="update-ready-title">
              Version {updateStatus.update?.version} is ready
            </p>
            <p className="settings-row-hint" style={{ marginBottom: 10 }}>
              Links will restart to finish installing.
            </p>
            {updateStatus.update?.releaseNotes && (
              <>
                <button
                  className="patch-notes-toggle"
                  onClick={() => setShowPatchNotes((s) => !s)}
                >
                  {showPatchNotes ? "Hide what's new" : "What's new in this version"}
                </button>
                {showPatchNotes && (
                  <div className="patch-notes-body">{updateStatus.update.releaseNotes}</div>
                )}
              </>
            )}
            <div className="button-row" style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={() => window.linksAPI.installUpdate()}>
                Restart &amp; update
              </button>
            </div>
          </div>
        ) : (
          <div className="settings-row">
            <div>
              <p className="settings-row-label">Version {appVersion || "…"}</p>
              <p className="settings-row-hint">{updateStatusLabel()}</p>
            </div>
            <button
              className="btn"
              onClick={handleCheckForUpdates}
              disabled={updateStatus.status === "checking" || updateStatus.status === "downloading"}
            >
              Check now
            </button>
          </div>
        )}
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
            <p className="settings-row-label">
              {connectionHealth.ok ? "Connected" : "Needs attention"}
            </p>
            <p className={`settings-row-hint${connectionHealth.ok ? "" : " settings-row-hint-attention"}`}>
              {connectionHealth.ok
                ? "Links can see what's playing and manage your queue."
                : connectionHealth.reason === "auth"
                ? "Links can't reach your Spotify account. Disconnect, then reconnect to restore it."
                : "Links couldn't reach Spotify just now. This usually resolves on its own."}
            </p>
          </div>
          <div className="button-row" style={{ margin: 0 }}>
            <button className="btn" onClick={handleCheckConnection} disabled={checkingConnection}>
              {checkingConnection ? "Checking…" : "Check now"}
            </button>
            <button className="btn" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </div>
      </div>

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

        <div className="settings-row" style={{ marginTop: 8 }}>
          <div>
            <p className="settings-row-label">Launch to tray</p>
            <p className="settings-row-hint">
              Start minimized in the system tray instead of opening a window, useful paired with
              Launch at login, so Links doesn't pop up every time you sign in.
            </p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={launchToTray}
              onChange={handleToggleLaunchToTray}
              aria-label="Launch Links minimized to the system tray"
            />
            <span className="toggle-switch-track" />
          </label>
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
            <p className="settings-row-hint">Save a backup file of every link you've created, plus your settings.</p>
          </div>
          <button className="btn" onClick={handleExportLinks}>
            Export
          </button>
        </div>

        <div className="settings-row" style={{ marginBottom: 8 }}>
          <div>
            <p className="settings-row-label">Import links</p>
            <p className="settings-row-hint">
              Add links and settings from a backup file, useful for moving to another device. Links
              already saved here are skipped automatically.
            </p>
          </div>
          <button className="btn" onClick={handleImportLinks}>
            Import
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

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
