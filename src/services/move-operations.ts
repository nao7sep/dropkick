// Task movement between lists.

import type { Task, TaskDto } from "../models";
import { groupMoveBySource, taskKey, taskSelectionKey } from "../utils";

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

// The outcome of moving the current selection to another list: what to select
// afterwards, and what (if anything) to tell the user.
export interface MoveSelectionOutcome {
  status: "success" | "error";
  // The selection to apply. On a mid-sequence failure this is a MIXED set: the
  // tasks whose source group already landed are keyed under the destination,
  // the rest under where they still are.
  selection: Set<string>;
  message?: string;
}

export interface MoveSelectionInputs {
  selectedTasks: Task[];
  destination: string;
  isUnifiedView: boolean;
  // The single list's path; ignored in unified view, where each task carries
  // its own source.
  sourceFilePath: string;
  // Where to land after a successful single-list move, which removes the tasks
  // from the view. In unified view the moved tasks stay visible, so they stay
  // selected instead.
  nextActiveTaskKey: string | null;
  moveTasks: (
    source: string,
    destination: string,
    taskIds: Set<string>,
  ) => Promise<{ status: string; message?: string }>;
}

// Moves the selected tasks to `destination`.
//
// A unified-view selection can span several files, and the store moves one
// source at a time, so the sequence can fail partway with some groups already
// written. That recovery — re-keying the landed tasks to the destination and
// leaving the rest where they are, and saying that some moved — is the subtlest
// part of the move path and was written out twice, in the modal and in the bulk
// actions, with neither covered by a test. It lives here so there is one copy
// and it can be exercised.
export async function moveSelectedTasks(
  inputs: MoveSelectionInputs,
): Promise<MoveSelectionOutcome> {
  const {
    selectedTasks,
    destination,
    isUnifiedView,
    sourceFilePath,
    nextActiveTaskKey,
    moveTasks,
  } = inputs;

  if (!isUnifiedView) {
    const taskIds = new Set(selectedTasks.map((t) => t.id));
    const result = await moveTasks(sourceFilePath, destination, taskIds);
    if (result.status === "error") {
      return {
        status: "error",
        selection: new Set(selectedTasks.map(taskSelectionKey)),
        message: result.message,
      };
    }
    return {
      status: "success",
      selection: nextActiveTaskKey ? new Set([nextActiveTaskKey]) : new Set(),
    };
  }

  const movedSources = new Set<string>();
  for (const [source, ids] of groupMoveBySource(selectedTasks)) {
    const result = await moveTasks(source, destination, ids);
    if (result.status === "error") {
      const movedAny = movedSources.size > 0;
      return {
        status: "error",
        selection: new Set(
          selectedTasks.map((task) =>
            movedSources.has(task.sourceFile)
              ? taskKey(destination, task.id)
              : taskSelectionKey(task),
          ),
        ),
        message: movedAny
          ? `Some selected tasks were moved before the operation stopped.\n\n${result.message}`
          : result.message,
      };
    }
    movedSources.add(source);
  }
  // The moved tasks are still visible in unified view, so they stay selected.
  return {
    status: "success",
    selection: new Set(selectedTasks.map((t) => taskKey(destination, t.id))),
  };
}
