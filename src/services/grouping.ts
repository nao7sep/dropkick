// Collects, groups and orders the tasks a view displays.
//
// Everything here is pure: it takes loaded task data and returns domain models,
// so the rules that decide *what the current view contains and in what order*
// can be tested without driving React. Those rules were previously written out
// in each pane, the keyboard handler and the window shell, which is how the
// keyboard's "next task" and the list's visible order could drift apart.

import type { Task, TaskGroup, TabDto, TaskListDto } from "../models";
import { TASK_GROUP_ORDER } from "../models";
import { toTask } from "../utils/domain-mapping";

export interface GroupedTasks {
  // Active task groups in display order. Empty groups are omitted.
  groups: { group: TaskGroup; label: string; tasks: Task[] }[];
  // Handled tasks (Completed + Dismissed), sorted by completedAtUtc descending.
  handled: Task[];
  handledTotal: number;
}

const GROUP_LABELS: Record<TaskGroup, string> = {
  PastDue: "Past Due",
  Critical: "Critical",
  DueToday: "Due Today",
  DueSoon: "Due Soon",
  Urgent: "Urgent",
  Important: "Important",
  Default: "Tasks",
};

// Groups and sorts active tasks for display.
//
// A list tab keeps each group's manual sort order (array position). The unified
// view additionally sorts within each group by creation time, newest first, so
// tasks from different files interleave chronologically instead of appearing in
// file order — that one sort is the only difference between the two views.
export function groupTasks(tasks: Task[], isUnifiedView: boolean): GroupedTasks {
  const active = tasks.filter((t) => t.status === "Pending");
  const handled = tasks
    .filter((t) => t.status === "Completed" || t.status === "Dismissed")
    .sort((a, b) => {
      // Most recently handled first.
      const aTime = a.completedAtUtc ?? "";
      const bTime = b.completedAtUtc ?? "";
      return bTime.localeCompare(aTime);
    });

  const groupMap = new Map<TaskGroup, Task[]>();
  for (const task of active) {
    const existing = groupMap.get(task.group);
    if (existing) {
      existing.push(task);
    } else {
      groupMap.set(task.group, [task]);
    }
  }

  if (isUnifiedView) {
    for (const groupTasks of groupMap.values()) {
      groupTasks.sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc));
    }
  }

  // Build groups in display order, skipping empty ones.
  const groups = TASK_GROUP_ORDER.filter((g) => groupMap.has(g)).map((g) => ({
    group: g,
    label: GROUP_LABELS[g],
    tasks: groupMap.get(g)!,
  }));

  return { groups, handled, handledTotal: handled.length };
}

// The loaded task data a view reads, keyed by file path. Typed structurally
// rather than as the store's own state so this module stays independent of it.
export type LoadedFiles = Record<string, { data: TaskListDto }>;

// Collects the tasks the current view contains.
//
// A list tab holds one file's tasks. The unified view merges every open list,
// skipping the unified tab itself and any file that is not loaded — whether it
// failed or is still loading. Each task is stamped with the path it came from,
// which is what lets a mutation reach the right file from a merged view.
export function collectViewTasks(
  files: LoadedFiles,
  openTabs: TabDto[],
  filePath: string,
  isUnifiedView: boolean,
  timezone: string | null,
  dueSoonDays: number,
): Task[] {
  if (!isUnifiedView) {
    const fileState = files[filePath];
    if (!fileState) return [];
    return fileState.data.tasks.map((dto) =>
      toTask(dto, filePath, timezone, dueSoonDays),
    );
  }

  const merged: Task[] = [];
  for (const tab of openTabs) {
    if (tab.isUnifiedView) continue;
    const fileState = files[tab.filePath];
    if (!fileState) continue;
    for (const dto of fileState.data.tasks) {
      merged.push(toTask(dto, tab.filePath, timezone, dueSoonDays));
    }
  }
  return merged;
}

// The active tasks in the order the list renders them — groups in display
// order, flattened. This is the order keyboard navigation walks, so it must
// come from the same grouping the list draws.
export function visualTaskOrder(grouped: GroupedTasks): Task[] {
  return grouped.groups.flatMap((group) => group.tasks);
}
