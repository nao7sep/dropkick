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
      { status: "validation", reason: "Has actionable notes" },
      { status: "error", message: "Disk full" },
    ]);

    expect(failures.map(({ task, reason }) => [task.title, reason])).toEqual([
      ["Beta", "Has actionable notes"],
      ["Gamma", "Disk full"],
    ]);
    expect(describeTaskActionFailures(failures)).toBe(
      "Beta: Has actionable notes\nGamma: Disk full",
    );
  });
});
