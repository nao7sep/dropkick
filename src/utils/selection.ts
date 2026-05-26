import type { Task } from "../models";

const TASK_SELECTION_SEPARATOR = "\u0000";

export interface TaskSelectionIdentity {
  sourceFile: string;
  taskId: string;
}

export function taskSelectionKey(
  task: Pick<Task, "sourceFile" | "id">,
): string {
  return taskKey(task.sourceFile, task.id);
}

export function taskKey(sourceFile: string, taskId: string): string {
  return `${sourceFile}${TASK_SELECTION_SEPARATOR}${taskId}`;
}

export function parseTaskKey(key: string): TaskSelectionIdentity | null {
  const separatorIndex = key.lastIndexOf(TASK_SELECTION_SEPARATOR);
  if (separatorIndex === -1) return null;

  return {
    sourceFile: key.slice(0, separatorIndex),
    taskId: key.slice(separatorIndex + TASK_SELECTION_SEPARATOR.length),
  };
}

// Pick the next active task in visual order after the current selection.
// Returns null at the end of the active list so callers do not follow tasks
// into the handled section after completion or dismissal.
export function pickNextActiveKey(
  selectedKeys: Set<string>,
  visualTasks: Task[],
): string | null {
  if (selectedKeys.size === 0) return null;

  const selectedIndexes = visualTasks
    .map((task, index) =>
      selectedKeys.has(taskSelectionKey(task)) ? index : -1,
    )
    .filter((index) => index !== -1);

  if (selectedIndexes.length === 0) return null;

  const lastSelectedIndex = Math.max(...selectedIndexes);
  const nextTask = visualTasks
    .slice(lastSelectedIndex + 1)
    .find((task) => !selectedKeys.has(taskSelectionKey(task)));

  return nextTask ? taskSelectionKey(nextTask) : null;
}
