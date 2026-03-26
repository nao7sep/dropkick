// Groups and sorts tasks for display.
// Active tasks are grouped by priority/due rules.
// Handled tasks are separate, sorted by completion time.

import type { Task, TaskGroup } from "../models";
import { TASK_GROUP_ORDER } from "../models";

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
  DueWithinWeek: "Due Within 7 Days",
  Urgent: "Urgent",
  Important: "Important",
  Default: "Tasks",
};

// Groups and sorts active tasks for an individual task list tab.
// Active tasks retain their manual sort order (array position) within each group.
export function groupTasksForList(tasks: Task[]): GroupedTasks {
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

  // Build groups in display order, skipping empty ones.
  const groups = TASK_GROUP_ORDER.filter((g) => groupMap.has(g)).map((g) => ({
    group: g,
    label: GROUP_LABELS[g],
    tasks: groupMap.get(g)!,
  }));

  return { groups, handled, handledTotal: handled.length };
}

// Groups and sorts tasks for the unified view.
// Within each group, tasks are sorted by createdAtUtc ascending (oldest first).
export function groupTasksForUnifiedView(tasks: Task[]): GroupedTasks {
  const active = tasks.filter((t) => t.status === "Pending");
  const handled = tasks
    .filter((t) => t.status === "Completed" || t.status === "Dismissed")
    .sort((a, b) => {
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

  // In unified view, sort within each group by creation time (oldest first).
  for (const tasks of groupMap.values()) {
    tasks.sort((a, b) => a.createdAtUtc.localeCompare(b.createdAtUtc));
  }

  const groups = TASK_GROUP_ORDER.filter((g) => groupMap.has(g)).map((g) => ({
    group: g,
    label: GROUP_LABELS[g],
    tasks: groupMap.get(g)!,
  }));

  return { groups, handled, handledTotal: handled.length };
}
