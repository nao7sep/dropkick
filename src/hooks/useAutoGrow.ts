// Auto-growing textarea hook.
// Adjusts textarea height to fit content, capped at 50vh with overflow scroll.

import { useCallback, useEffect } from "react";

/**
 * Returns an `autoGrow` function that resizes a textarea to its content.
 * Call it on every content change and when the initial value is set.
 * The textarea must have `resize-none` and no fixed height in CSS.
 */
export function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>) {
  const autoGrow = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const maxH = window.innerHeight * 0.5;
    if (el.scrollHeight > maxH) {
      el.style.height = `${maxH}px`;
      el.style.overflowY = "auto";
    } else {
      el.style.height = `${el.scrollHeight}px`;
      el.style.overflowY = "hidden";
    }
  }, [ref]);

  // Re-measure when the ref's value changes externally (e.g. task switch).
  useEffect(() => autoGrow(), [autoGrow]);

  return autoGrow;
}
