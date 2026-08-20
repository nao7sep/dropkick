// The one place that answers "what does the current view contain, and in what
// order?" for every surface that needs it — the list pane, the detail pane, the
// keyboard handler and the window shell.
//
// It exists because that answer decides two things that must agree: what the
// list draws, and what the keyboard advances to. Written out separately in each
// consumer, a change to the merge or ordering rule could land in some and not
// others, and the panes would silently disagree about the same view. The rules
// themselves are pure and live in services/grouping; this hook only wires the
// stores to them.

import { useMemo } from "react";
import type { Task } from "../models";
import {
  collectViewTasks,
  groupTasks,
  visualTaskOrder,
  type GroupedTasks,
} from "../services";
import { useTaskListStore } from "../state/task-list-store";
import { useWorkspaceStore } from "../state/workspace-store";
import { usePreferencesStore } from "../state/preferences-store";

export interface ViewTasks {
  // Every task in the view, unordered beyond its source order.
  tasks: Task[];
  // The same tasks grouped for display, plus the handled archive.
  grouped: GroupedTasks;
  // The active tasks flattened in the order the list renders them.
  visualTasks: Task[];
}

export function useViewTasks(
  filePath: string,
  isUnifiedView: boolean,
): ViewTasks {
  const files = useTaskListStore((s) => s.files);
  const openTabs = useWorkspaceStore((s) => s.workspace.openTabs);
  const timezone = usePreferencesStore((s) => s.preferences.timezone);
  const dueSoonDays = usePreferencesStore((s) => s.preferences.dueSoonDays);

  const tasks = useMemo(
    () =>
      collectViewTasks(
        files,
        openTabs,
        filePath,
        isUnifiedView,
        timezone,
        dueSoonDays,
      ),
    [files, openTabs, filePath, isUnifiedView, timezone, dueSoonDays],
  );

  const grouped = useMemo(
    () => groupTasks(tasks, isUnifiedView),
    [tasks, isUnifiedView],
  );

  const visualTasks = useMemo(() => visualTaskOrder(grouped), [grouped]);

  return { tasks, grouped, visualTasks };
}
