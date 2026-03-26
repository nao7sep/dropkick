// Kick mechanism — moves tasks down the list by a fixed number of positions.
// Operates on task DTOs (array position = display order).

import type { TaskDto } from "../models";

// Kicks selected tasks down by `distance` positions within the active (Pending) portion.
// Handled tasks are not affected — kicked tasks stay above them.
// When multiple tasks are selected, they move together preserving relative order.
// Returns a new array (does not mutate the input).
export function kickTasks(
  tasks: TaskDto[],
  selectedIds: Set<string>,
  distance: number,
): TaskDto[] {
  // Split into active (Pending) and handled (Completed/Dismissed).
  // We only reorder within the active portion.
  const active = tasks.filter((t) => t.status === "Pending");
  const handled = tasks.filter((t) => t.status !== "Pending");

  const selected: TaskDto[] = [];
  const remaining: TaskDto[] = [];

  for (const task of active) {
    if (selectedIds.has(task.id)) {
      selected.push(task);
    } else {
      remaining.push(task);
    }
  }

  if (selected.length === 0) return tasks;

  // Find the lowest position of any selected task among active tasks.
  const firstSelectedIndex = active.findIndex((t) => selectedIds.has(t.id));

  // Calculate insertion point: original position + distance, clamped to end of remaining.
  // We subtract selected.length because the selected items were removed from `remaining`.
  const insertAfter = Math.min(
    firstSelectedIndex + distance,
    remaining.length,
  );

  // Rebuild: remaining[0..insertAfter] + selected + remaining[insertAfter..] + handled
  const result = [
    ...remaining.slice(0, insertAfter),
    ...selected,
    ...remaining.slice(insertAfter),
    ...handled,
  ];

  return result;
}

// Sends selected tasks to the end of the active portion (just above handled tasks).
// Returns a new array.
export function kickTasksToEnd(
  tasks: TaskDto[],
  selectedIds: Set<string>,
): TaskDto[] {
  const active = tasks.filter((t) => t.status === "Pending");
  const handled = tasks.filter((t) => t.status !== "Pending");

  const selected: TaskDto[] = [];
  const remaining: TaskDto[] = [];

  for (const task of active) {
    if (selectedIds.has(task.id)) {
      selected.push(task);
    } else {
      remaining.push(task);
    }
  }

  return [...remaining, ...selected, ...handled];
}
