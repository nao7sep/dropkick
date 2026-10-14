import type { Task } from "../models";
import type { ActionResult } from "../state";
import { message, type Message } from "../i18n/translate";
import { NAMED_FEW, shortenName } from "../utils";

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
      reason: result.status === "validation" ? result.reason : result.message,
    });
  }
  return failures;
}

// One line per failed task, "title: reason", for the first few; the rest are
// counted (interface-styling-conventions, Labels). The failed tasks stay
// selected, so the whole set is reachable in the list.
export function describeTaskActionFailures(
  failures: readonly TaskActionFailure[],
): Message {
  const lines = failures.slice(0, NAMED_FEW).map(({ task, reason }) =>
    message("task.failureLine", { title: shortenName(task.title) || message("common.untitled"), reason }),
  );
  const rest = failures.length - lines.length;
  if (rest > 0) lines.push(message("common.andMore", { count: rest }));
  return lines.reduceRight((rest, first) => message("common.lines", { first, rest }));
}
