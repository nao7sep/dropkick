// Task movement between lists.

import type { TaskDto } from "../models";

export interface MoveResult {
  // Updated task arrays ready to be written to disk.
  sourceTasks: TaskDto[];
  destinationTasks: TaskDto[];
}

// Prepares a move operation: removes selected tasks from source,
// adds them to the top of destination, preserving relative order.
export function prepareMoveOperation(
  sourceTasks: TaskDto[],
  destinationTasks: TaskDto[],
  selectedIds: Set<string>,
): MoveResult {
  const tasksToMove: TaskDto[] = [];
  const remaining: TaskDto[] = [];

  // Preserve relative order of selected tasks.
  for (const task of sourceTasks) {
    if (selectedIds.has(task.id)) {
      tasksToMove.push(task);
    } else {
      remaining.push(task);
    }
  }

  return {
    sourceTasks: remaining,
    destinationTasks: [...tasksToMove, ...destinationTasks],
  };
}
