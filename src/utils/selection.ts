import type { Task } from "../models";

// Pick the next active task in visual order after the current selection.
// Returns null at the end of the active list so callers do not follow tasks
// into the handled section after completion or dismissal.
export function pickNextActiveId(
  selectedIds: Set<string>,
  visualTasks: Task[],
): string | null {
  if (selectedIds.size === 0) return null;

  const selectedIndexes = visualTasks
    .map((task, index) => (selectedIds.has(task.id) ? index : -1))
    .filter((index) => index !== -1);

  if (selectedIndexes.length === 0) return null;

  const lastSelectedIndex = Math.max(...selectedIndexes);
  return visualTasks
    .slice(lastSelectedIndex + 1)
    .find((task) => !selectedIds.has(task.id))?.id ?? null;
}

