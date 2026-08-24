import { useEffect, useState } from "react";
import type { Link } from "../../electron/linkStore";
import type { NotificationEntry } from "../../electron/notificationStore";
import EngineHeartbeat from "../components/EngineHeartbeat";

function linkTitle(link: Link): string {
  if (link.title) return link.title;
  const first = link.tracks[0];
  return first.album ? `${first.artist} · ${first.album}` : first.artist;
}

function uniqueCovers(link: Link): string[] {
  const seen = new Set<string>();
  for (const track of link.tracks) {
    if (track.albumArt) seen.add(track.albumArt);
  }
  return [...seen];
}

function formatTimestamp(ts: number): string {
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

interface LinkHealth {
  link: Link;
  brokenCount: number;
  latestNotification: NotificationEntry | null;
}

export default function HealthPage() {
  const [health, setHealth] = useState<LinkHealth[] | null>(null);

  useEffect(() => {
    refresh();
    return window.linksAPI.onNewNotification(() => refresh());
  }, []);

  async function refresh() {
    const [links, brokenUris] = await Promise.all([
      window.linksAPI.getLinks(),
      window.linksAPI.getBrokenTrackUris()
    ]);

    const withHealth = await Promise.all(
      links.map(async (link) => ({
        link,
        brokenCount: link.tracks.filter((t) => brokenUris.includes(t.uri)).length,
        latestNotification: await window.linksAPI.getLatestNotificationForLink(link.id)
      }))
    );

    setHealth(withHealth);
  }

  const healthyCount = health?.filter((h) => h.brokenCount === 0 && h.latestNotification?.level !== "warning").length ?? 0;
  const attentionCount = health ? health.length - healthyCount : 0;

  return (
    <div className="screen">
      <div className="list-header">
        <p className="list-header-count">Health</p>
      </div>

      <EngineHeartbeat />

      {health === null && <p className="muted">Loading…</p>}

      {health !== null && health.length === 0 && (
        <div className="empty-state">
          <p className="empty-title">No links yet</p>
          <p className="empty-body">Once you create a link, its reliability shows up here.</p>
        </div>
      )}

      {health !== null && health.length > 0 && (
        <p className="health-summary">
          {attentionCount === 0
            ? `All ${health.length} link${health.length === 1 ? "" : "s"} look healthy.`
            : `${attentionCount} of ${health.length} link${health.length === 1 ? "" : "s"} need${attentionCount === 1 ? "s" : ""} attention.`}
        </p>
      )}

      <div className="health-list">
        {health?.map(({ link, brokenCount, latestNotification }) => {
          const covers = uniqueCovers(link);
          const hasBroken = brokenCount > 0;
          const hasWarning = !hasBroken && latestNotification?.level === "warning";
          const isAttention = hasBroken || hasWarning;

          return (
            <div className={`health-item${isAttention ? " health-item-attention" : ""}`} key={link.id}>
              {covers.length >= 2 ? (
                <span className="link-cover-stack">
                  <img className="link-cover-back" src={covers[1]} alt="" />
                  <img className="link-cover-front" src={covers[0]} alt="" />
                </span>
              ) : covers.length === 1 ? (
                <img className="link-cover" src={covers[0]} alt="" />
              ) : (
                <div className="link-cover link-cover-empty" />
              )}

              <div className="health-item-body">
                <p className="health-item-title">
                  {linkTitle(link)}
                  {!link.active && <span className="health-paused-badge">Paused</span>}
                </p>

                {hasBroken ? (
                  <p className="health-item-status health-item-status-attention">
                    {brokenCount} track{brokenCount === 1 ? "" : "s"} no longer available on Spotify
                  </p>
                ) : hasWarning ? (
                  <p className="health-item-status health-item-status-attention">
                    {latestNotification!.message}
                  </p>
                ) : latestNotification ? (
                  <p className="health-item-status">
                    Working normally · last activity {formatTimestamp(latestNotification.timestamp)}
                  </p>
                ) : (
                  <p className="health-item-status health-item-status-muted">
                    Hasn't been played yet this session
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
