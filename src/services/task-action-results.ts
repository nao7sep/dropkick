import type { Task } from "../models";
import type { ActionResult } from "../state";
import { message, type Message } from "../i18n/translate";

export interface TaskActionFailure {
  task: Task;
  reason: Message;
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

// One line per failed task, "title: reason".
export function describeTaskActionFailures(
  failures: readonly TaskActionFailure[],
): Message {
  const lines = failures.map(({ task, reason }) =>
    message("task.failureLine", { title: task.title || message("common.untitled"), reason }),
  );
  return lines.reduceRight((rest, first) => message("common.lines", { first, rest }));
}
