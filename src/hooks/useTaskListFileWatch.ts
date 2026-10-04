// Hands the open task lists' on-disk changes to the store, one per burst.
//
// A single save reaches the watcher as several events (a temp file renamed over
// the list, an editor's write-then-touch, a sync tool's passes), so each path
// waits until its events have been quiet for SETTLE_MS before it is read back.
// The app's own saves arrive here too; the store reads them back as unchanged.

import { useEffect } from "react";
import { onFileChanged } from "../repositories";
import { useTaskListStore } from "../state/task-list-store";

const SETTLE_MS = 300;

export function useTaskListFileWatch(): void {
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const stop = onFileChanged((path) => {
      clearTimeout(timers.get(path));
      timers.set(
        path,
        setTimeout(() => {
          timers.delete(path);
          void useTaskListStore.getState().refreshFromDisk(path);
        }, SETTLE_MS),
      );
    });
    return () => {
      stop();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);
}
