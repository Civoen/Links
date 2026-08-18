import { useEffect } from "react";

export default function Toast({
  message,
  actionLabel,
  onAction,
  onDismiss,
  durationMs = 4000
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  durationMs?: number;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  return (
    <div className="toast">
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
