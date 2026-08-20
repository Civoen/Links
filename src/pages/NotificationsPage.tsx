import { useEffect, useState } from "react";
import type { NotificationEntry } from "../../electron/notificationStore";

function formatTimestamp(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;

  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationEntry[] | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    refresh();
    // New notifications while this page is open should appear immediately,
    // not just the next time it's reopened.
    return window.linksAPI.onNewNotification(() => refresh());
  }, []);

  function refresh() {
    window.linksAPI.getNotifications().then(setNotifications);
  }

  async function handleClear() {
    setClearing(true);
    try {
      await window.linksAPI.clearNotifications();
      setNotifications([]);
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="screen">
      <div className="list-header">
        <p className="list-header-count">Notifications</p>
        {notifications !== null && notifications.length > 0 && (
          <button className="btn" onClick={handleClear} disabled={clearing}>
            {clearing ? "Clearing…" : "Clear"}
          </button>
        )}
      </div>

      {notifications === null && <p className="muted">Loading…</p>}

      {notifications !== null && notifications.length === 0 && (
        <div className="empty-state">
          <p className="empty-title">Nothing yet</p>
          <p className="empty-body">
            When Links queues a track, fixes a shuffled order, or runs into something Spotify's
            side won't allow, it'll show up here.
          </p>
        </div>
      )}

      <div className="notification-list">
        {notifications?.map((n) => (
          <div className={`notification-item${n.level === "warning" ? " notification-warning" : ""}`} key={n.id}>
            <span className="notification-icon">
              {n.level === "warning" ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.5" />
                  <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L12.5 19.5" />
                </svg>
              )}
            </span>
            <div className="notification-body">
              <p className="notification-message">{n.message}</p>
              <p className="notification-time">{formatTimestamp(n.timestamp)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
