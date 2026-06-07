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
