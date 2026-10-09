// Re-reads open task lists as the user returns to them, so a change made
// outside the app (a git checkout, an editor, a synced folder) shows up without
// watching the files.
//
// The unit is a list's tab: activating it re-reads that list. The unified view
// shows every open list, so activating it re-reads all of them, and so does the
// window regaining focus, the usual way back from the other program. A list not
// loaded yet is left to its load. refreshFromDisk keeps the loaded copy of a
// list the app holds edits for, and the app's own saves read back unchanged.

import { useEffect } from "react";
import { onWindowFocused } from "../repositories";
import { useTaskListStore } from "../state/task-list-store";

function refreshLoaded(paths?: readonly string[]): void {
  const store = useTaskListStore.getState();
  for (const path of paths ?? Object.keys(store.files)) {
    if (store.files[path]) void store.refreshFromDisk(path);
  }
}

export function useTaskListRefresh(
  activeTab: { filePath: string; isUnifiedView: boolean } | null | undefined,
): void {
  const activePath = activeTab?.isUnifiedView ? null : activeTab?.filePath;
  const unified = activeTab?.isUnifiedView ?? false;

  useEffect(() => {
    if (unified) refreshLoaded();
    else if (activePath) refreshLoaded([activePath]);
  }, [activePath, unified]);

  useEffect(() => onWindowFocused(() => refreshLoaded()), []);
}
