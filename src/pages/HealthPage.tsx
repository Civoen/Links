import { useEffect, useState } from "react";
import type { Link } from "../../electron/linkStore";
import type { LinkStatus } from "../../electron/linkStatusStore";
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

function describeContextType(contextType: string | null): string {
  if (contextType === "playlist") return "a playlist";
  if (contextType === "album") return "an album";
  if (contextType === "artist") return "an artist";
  if (contextType === "show") return "a podcast";
  return "an unrecognized context";
}

interface LinkHealth {
  link: Link;
  brokenCount: number;
  status: LinkStatus | null;
}

interface CurrentContext {
  isPlaying: boolean;
  contextType: string | null;
  shuffle: boolean;
  observedAt: number;
}

export default function HealthPage() {
  const [health, setHealth] = useState<LinkHealth[] | null>(null);
  const [context, setContext] = useState<CurrentContext | null>(null);
  const [recheckingId, setRecheckingId] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    refreshContext();
    const unsubscribe = window.linksAPI.onNewNotification(() => refresh());
    // Context can change without a notification ever firing (e.g. simply
    // switching from a playlist to an album with nothing else happening),
    // so it gets its own light polling rather than piggybacking on events.
    const contextInterval = setInterval(refreshContext, 5000);
    return () => {
      unsubscribe();
      clearInterval(contextInterval);
    };
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
        status: await window.linksAPI.getLinkStatus(link.id)
      }))
    );

    setHealth(withHealth);
  }

  async function refreshContext() {
    setContext(await window.linksAPI.getCurrentContext());
  }

  async function handleRecheck(linkId: string) {
    setRecheckingId(linkId);
    try {
      await window.linksAPI.recheckBrokenTrackUris();
      await refresh();
    } finally {
      setRecheckingId(null);
    }
  }

  const healthyCount = health?.filter((h) => h.brokenCount === 0 && h.status?.level !== "warning").length ?? 0;
  const attentionCount = health ? health.length - healthyCount : 0;

  return (
    <div className="screen">
      <div className="list-header">
        <p className="list-header-count">Health</p>
      </div>

      <EngineHeartbeat />

      <p className="health-context-line">
        {!context || !context.isPlaying
          ? "Nothing is currently playing."
          : `Currently watching ${describeContextType(context.contextType)}, shuffle ${context.shuffle ? "on" : "off"}.`}
      </p>

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
        {health?.map(({ link, brokenCount, status }) => {
          const covers = uniqueCovers(link);
          const hasBroken = brokenCount > 0;
          const hasWarning = !hasBroken && status?.level === "warning";
          const isAttention = hasBroken || hasWarning;
          const isRechecking = recheckingId === link.id;

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
                    {status!.message}
                  </p>
                ) : status ? (
                  <p className="health-item-status">
                    Working normally · last activity {formatTimestamp(status.updatedAt)}
                  </p>
                ) : (
                  <p className="health-item-status health-item-status-muted">
                    Hasn't been played yet this session
                  </p>
                )}
              </div>

              <button
                className="health-recheck-btn"
                onClick={() => handleRecheck(link.id)}
                disabled={isRechecking}
                aria-label={`Recheck ${linkTitle(link)}`}
                title="Recheck against Spotify"
              >
                {isRechecking ? (
                  "…"
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 4v6h-6" />
                    <path d="M1 20v-6h6" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
