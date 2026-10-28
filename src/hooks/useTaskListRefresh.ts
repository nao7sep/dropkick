// Re-reads open task lists as the user returns to them, so a change made
// outside the app (a git checkout, an editor, a synced folder) shows up without
// watching the files.
//
// The unit is a list's tab: activating it re-reads that list. The unified view
// shows every open list, so activating it re-reads all of them, and so does the
// window regaining focus, the usual way back from the other program. A list not
// loaded yet is left to its load. refreshFromDisk keeps the loaded copy of a
// list the app holds edits for, and the app's own saves read back unchanged.

import { refreshCalendarDay } from "./useCalendarDay";
import { useEffect, useRef } from "react";
import { onWindowFocused } from "../repositories";
import { useTaskListStore } from "../state/task-list-store";

// One list at a time (serial by default), the active list first.
async function refreshLoaded(first: string | null, paths?: readonly string[]): Promise<void> {
  const all = paths ?? Object.keys(useTaskListStore.getState().files);
  const ordered = first && all.includes(first) ? [first, ...all.filter((path) => path !== first)] : all;
  for (const path of ordered) {
    const store = useTaskListStore.getState();
    if (store.files[path]) await store.refreshFromDisk(path);
  }
}

export function useTaskListRefresh(
  activeTab: { filePath: string; isUnifiedView: boolean } | null | undefined,
): void {
  const activePath = activeTab?.isUnifiedView ? null : activeTab?.filePath ?? null;
  const unified = activeTab?.isUnifiedView ?? false;
  const active = useRef(activePath);
  active.current = activePath;

  useEffect(() => {
    if (unified) void refreshLoaded(null);
    else if (activePath) void refreshLoaded(null, [activePath]);
  }, [activePath, unified]);

  useEffect(() => onWindowFocused(() => { refreshCalendarDay(); void refreshLoaded(active.current); }), []);
}
