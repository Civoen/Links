import { useEffect, useState } from "react";

// A bit over 2x the 3-second poll interval — long enough that a single
// slow tick doesn't falsely read as stalled, short enough that a
// genuinely stuck engine gets noticed quickly.
const STALE_THRESHOLD_MS = 8000;

export default function EngineHeartbeat() {
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [pulseKey, setPulseKey] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    // Each pulse is triggered by a real, completed poll from the main
    // process — see linkEngine.ts's onTick, which only fires for a tick
    // that actually ran, not one skipped by the overlap guard. This isn't
    // a decorative loop; if the engine genuinely stalls, the pulses stop.
    const unsubscribe = window.linksAPI.onEngineTick(() => {
      setLastTickAt(Date.now());
      setPulseKey((k) => k + 1);
    });

    const clockInterval = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      unsubscribe();
      clearInterval(clockInterval);
    };
  }, []);

  const isStale = lastTickAt === null || now - lastTickAt > STALE_THRESHOLD_MS;

  function statusText(): string {
    if (lastTickAt === null) return "Waiting for first check…";
    if (isStale) return "Not responding — will retry automatically";
    const secondsAgo = Math.round((now - lastTickAt) / 1000);
    return secondsAgo < 2 ? "Watching Spotify · checked just now" : `Watching Spotify · checked ${secondsAgo}s ago`;
  }

  return (
    <div className={`heartbeat${isStale ? " heartbeat-stale" : ""}`}>
      <svg key={pulseKey} className="heartbeat-svg" viewBox="0 0 140 28" width="70" height="14" aria-hidden="true">
        <polyline
          className="heartbeat-line"
          points="0,14 22,14 27,3 33,25 38,14 62,14 67,3 73,25 78,14 102,14 107,3 113,25 118,14 140,14"
          fill="none"
        />
      </svg>
      <span className="heartbeat-text">{statusText()}</span>
    </div>
  );
}
