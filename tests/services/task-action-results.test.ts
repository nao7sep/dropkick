import { inEnglish } from "../helpers/i18n";
import { message } from "../../src/i18n/translate";
import { describe, expect, it } from "vitest";
import type { Task } from "../../src/models";
import {
  collectTaskActionFailures,
  describeTaskActionFailures,
  taskActionOwnerKey,
} from "../../src/services/task-action-results";
import { makeTask } from "../helpers/task";

function task(id: string, title: string): Task {
  return {
    ...makeTask({ id, title }),
    sourceFile: `/${id}.json`,
    hasActionableNotes: false,
    canComplete: true,
    isOverdue: false,
    isDueToday: false,
    group: "Default",
  };
}

describe("task action results", () => {
  it("uses one owner key for the same surviving selection in any order", () => {
    const first = "/one.json\u0000a";
    const second = "/two.json\u0000b";

    expect(taskActionOwnerKey([first, second])).toBe(
      taskActionOwnerKey([second, first]),
    );
    expect(taskActionOwnerKey([second, first, second])).toBe(
      taskActionOwnerKey([first, second]),
    );
  });

  it("keeps each partial failure with the affected task", () => {
    const tasks = [task("a", "Alpha"), task("b", "Beta"), task("c", "Gamma")];
    const failures = collectTaskActionFailures(tasks, [
      { status: "success" },
      { status: "validation", reason: message("task.cannotComplete", { count: 1 }) },
      { status: "error", message: message("write.taskList") },
    ]);

    expect(failures.map(({ task, reason }) => [task.title, inEnglish(reason)])).toEqual([
      ["Beta", "Cannot complete: 1 actionable note remaining"],
      ["Gamma", "The task list could not be saved. Your change was not saved; try again."],
    ]);
    expect(inEnglish(describeTaskActionFailures(failures))).toBe(
      "Beta: Cannot complete: 1 actionable note remaining\nGamma: The task list could not be saved. Your change was not saved; try again.",
    );
  });
});
