// Summarizes a task list's most pressing deadline into a single urgency level,
// so a tab can flag at a glance that it holds work due today or already overdue.
//
// This is deliberately date-only and independent of the importance groups
// (Critical / Important / Urgent): a Critical task that also happens to be due
// today is filed under Critical by computeGroup, yet its deadline is exactly the
// thing this signal exists to surface. So it reads the due dates directly rather
// than the computed display group.

import type { TaskDto } from "../models";
import { isOverdue, isDueInDayRange } from "../utils/dates";

// Ordered most-pressing first; null means nothing is due today or overdue.
export type ListUrgency = "PastDue" | "DueToday" | null;

// The most pressing deadline among a list's pending tasks. Handled tasks
// (Completed / Dismissed) and tasks without a due date are ignored. PastDue
// outranks DueToday, so any overdue task settles the result immediately —
// array order does not matter.
export function computeListUrgency(
  tasks: readonly TaskDto[],
  timezone: string | null,
): ListUrgency {
  let dueToday = false;
  for (const task of tasks) {
    if (task.status !== "Pending" || task.dueDate === null) continue;
    if (isOverdue(task.dueDate, timezone)) return "PastDue";
    if (isDueInDayRange(task.dueDate, 0, 1, timezone)) dueToday = true;
  }
  return dueToday ? "DueToday" : null;
}

// Resolves the deadline-dot urgency for every tab, keyed by file path. Unified
// view is omitted (it lists every task inline, so a roll-up dot points nowhere
// new). A tab whose file failed to load, or is not loaded yet, resolves to null
// (no dot) — a load failure is signalled separately by the tab's own icon.
//
// Callers must load every open list's file for this to be complete; otherwise a
// not-yet-loaded list reads as null (no dot), which is indistinguishable from
// "nothing due". `loadErrorPaths` is the set of file paths whose load failed.
// The `files` shape is declared structurally (only what's read) so this service
// stays decoupled from the store's file-state type.
export function computeTabUrgencies(
  openTabs: readonly { isUnifiedView: boolean; filePath: string }[],
  files: Readonly<Record<string, { data: { tasks: readonly TaskDto[] } }>>,
  loadErrorPaths: ReadonlySet<string>,
  timezone: string | null,
): Record<string, ListUrgency> {
  const result: Record<string, ListUrgency> = {};
  for (const tab of openTabs) {
    if (tab.isUnifiedView) continue;
    const file = files[tab.filePath];
    result[tab.filePath] =
      file && !loadErrorPaths.has(tab.filePath)
        ? computeListUrgency(file.data.tasks, timezone)
        : null;
  }
  return result;
}
