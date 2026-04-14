// Domain models extend DTOs with computed properties.
// These are used in-memory only and are never serialized to JSON.

import type { TaskDto } from "./task-list";

export type TaskGroup =
  | "PastDue"
  | "Critical"
  | "DueWithinWeek"
  | "Urgent"
  | "Important"
  | "Default";

// The order defines display priority (lower index = shown higher).
export const TASK_GROUP_ORDER: TaskGroup[] = [
  "PastDue",
  "Critical",
  "DueWithinWeek",
  "Important",
  "Urgent",
  "Default",
];

export interface Task extends TaskDto {
  // Computed properties
  hasActionableNotes: boolean;
  canComplete: boolean; // false if any note is Actionable
  isOverdue: boolean;
  isDueWithinWeek: boolean;
  group: TaskGroup;

  // Source tracking (which task list this belongs to)
  sourceFile: string;
}
