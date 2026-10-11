// One clock for every date-derived view. The date is the snapshot, so ticks
// do not render or rescan task lists until their preferred calendar day changes.
import { useCallback, useSyncExternalStore } from "react";
import { todayInTimezone } from "../utils/dates";
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
export function refreshCalendarDay(): void { for (const listener of listeners) listener(); }
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    timer = setInterval(refreshCalendarDay, 30_000);
    window.addEventListener("focus", refreshCalendarDay);
    document.addEventListener("visibilitychange", refreshCalendarDay);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      window.removeEventListener("focus", refreshCalendarDay);
      document.removeEventListener("visibilitychange", refreshCalendarDay);
    }
  };
}
export function useCalendarDay(timezone: string): string {
  const snapshot = useCallback(() => todayInTimezone(timezone), [timezone]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
