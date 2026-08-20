import { useEffect } from "react";

export default function Toast({
  message,
  level = "info",
  actionLabel,
  onAction,
  onDismiss,
  durationMs
}: {
  message: string;
  level?: "info" | "warning";
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  durationMs?: number;
}) {
  const effectiveDuration = durationMs ?? (level === "warning" ? 7000 : 4000);

  useEffect(() => {
    const timer = setTimeout(onDismiss, effectiveDuration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  return (
    <div className={`toast${level === "warning" ? " toast-warning" : ""}`}>
      <span className="toast-message">{message}</span>
      {actionLabel && onAction && (
        <button
          className="toast-action"
          onClick={() => {
            onAction();
            onDismiss();
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
