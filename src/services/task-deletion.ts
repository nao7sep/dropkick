import type { Task } from "../models";
import type { ActionResult } from "../state";

export interface DeleteSelectedTasksInputs {
  selectedTasks: readonly Task[];
  removeTasks: (
    filePath: string,
    taskIds: ReadonlySet<string>,
  ) => Promise<ActionResult>;
  clearTaskDrafts: (taskId: string) => void;
}

export interface DeleteSelectedTasksResult {
  deletedTasks: Task[];
  failedTasks: Task[];
  firstError: string | null;
}

// Deletes one selection with at most one write per source list. A source-file
// failure leaves every task from that file intact and selected; successful
// files still land, and only their now-orphaned note drafts are cleared.
export async function deleteSelectedTasks({
  selectedTasks,
  removeTasks,
  clearTaskDrafts,
}: DeleteSelectedTasksInputs): Promise<DeleteSelectedTasksResult> {
  const bySource = new Map<string, Task[]>();
  for (const task of selectedTasks) {
    const group = bySource.get(task.sourceFile) ?? [];
    group.push(task);
    bySource.set(task.sourceFile, group);
  }

  const deletedTasks: Task[] = [];
  const failedTasks: Task[] = [];
  let firstError: string | null = null;

  for (const [sourceFile, tasks] of bySource) {
    const result = await removeTasks(
      sourceFile,
      new Set(tasks.map((task) => task.id)),
    );
    if (result.status === "success") {
      deletedTasks.push(...tasks);
      for (const task of tasks) clearTaskDrafts(task.id);
      continue;
    }

    failedTasks.push(...tasks);
    if (firstError === null) {
      firstError = result.status === "error" ? result.message : result.reason;
    }
  }

  return { deletedTasks, failedTasks, firstError };
}
