// Renders the current toast (see toast-store) bottom-center and clears it after
// a short delay. The CSS animation (dropkick-toast in App.css) fades it in and
// back out over the same duration, so the timed unmount lands on the fade-out.

import { useEffect } from "react";
import { useToastStore } from "../../state/toast-store";

const DISMISS_MS = 2500;

export function ToastHost() {
  const message = useToastStore((s) => s.message);
  const token = useToastStore((s) => s.token);
  const clearToast = useToastStore((s) => s.clearToast);

  useEffect(() => {
    if (message === null) return;
    const id = window.setTimeout(() => clearToast(token), DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [message, token, clearToast]);

  if (message === null) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-8 z-[120] flex justify-center px-4">
      {/* key={token} restarts the animation when a new toast replaces this one. */}
      <div
        key={token}
        role="status"
        className="dropkick-toast max-w-[90vw] rounded-md border border-warning/40 bg-warning-surface px-4 py-2 text-sm text-warning-strong shadow-lg"
      >
        {message}
      </div>
    </div>
  );
}
