import type { Task } from "../models";
import type { ActionResult } from "../state";

export interface TaskActionFailure {
  task: Task;
  reason: string;
}

export function taskActionOwnerKey(ownerKeys: readonly string[]): string {
  return JSON.stringify([...new Set(ownerKeys)].sort());
}

export function collectTaskActionFailures(
  tasks: readonly Task[],
  results: readonly ActionResult[],
): TaskActionFailure[] {
  const failures: TaskActionFailure[] = [];
  for (let index = 0; index < tasks.length; index += 1) {
    const result = results[index];
    if (!result || result.status === "success") continue;
    failures.push({
      task: tasks[index],
      reason: result.status === "error" ? result.message : result.reason,
    });
  }
  return failures;
}

export function describeTaskActionFailures(
  failures: readonly TaskActionFailure[],
): string {
  return failures
    .map(({ task, reason }) => `${task.title || "Untitled"}: ${reason}`)
    .join("\n");
}
