// Renders app-level nonmodal results. Ordinary no-op feedback clears after a
// short delay; a background-save failure is a separate persistent alert that a
// lower-severity toast cannot replace.

import { useEffect } from "react";
import { X } from "lucide-react";
import { useToastStore } from "../../state/toast-store";

const DISMISS_MS = 2500;

export function ToastHost() {
  const message = useToastStore((s) => s.message);
  const token = useToastStore((s) => s.token);
  const clearToast = useToastStore((s) => s.clearToast);
  const backgroundWriteError = useToastStore((s) => s.backgroundWriteError);
  const clearBackgroundWriteError = useToastStore(
    (s) => s.clearBackgroundWriteError,
  );

  useEffect(() => {
    if (message === null) return;
    const id = window.setTimeout(() => clearToast(token), DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [message, token, clearToast]);

  if (message === null && backgroundWriteError === null) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-8 z-[120] flex flex-col items-center gap-2 px-4">
      {backgroundWriteError ? (
        <div
          role="alert"
          className="pointer-events-auto flex max-w-[90vw] items-start gap-2 rounded-md border border-danger-border bg-danger-surface px-4 py-2 text-sm text-danger-fg-strong shadow-lg"
        >
          <div className="min-w-0 flex-1">
            <div>{backgroundWriteError.message}</div>
          </div>
          <button
            type="button"
            aria-label="Dismiss save error"
            title="Dismiss"
            onClick={() => clearBackgroundWriteError()}
            className="shrink-0 rounded p-0.5 text-danger hover:bg-danger-surface-strong"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
      {message !== null ? (
        <div
          key={token}
          role="status"
          className="dropkick-toast max-w-[90vw] rounded-md border border-warning/40 bg-warning-surface px-4 py-2 text-sm text-warning-strong shadow-lg"
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
