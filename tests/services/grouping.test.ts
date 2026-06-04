import { describe, it, expect } from "vitest";
import { groupTasksForList, groupTasksForUnifiedView } from "../../src/services/grouping";
import { makeTask } from "../helpers/task";
import type { Task, TaskGroup } from "../../src/models";

// grouping operates on Task (domain) objects, which carry a precomputed `group`.
// These tests set `group` directly to isolate the grouping/sorting logic from
// computeGroup (covered in domain-mapping.test.ts).
function task(overrides: Partial<Task>): Task {
  return {
    ...makeTask(overrides),
    hasActionableNotes: false,
    canComplete: true,
    isOverdue: false,
    isDueToday: false,
    group: overrides.group ?? "Default",
    sourceFile: overrides.sourceFile ?? "/a.json",
  };
}

describe("groupTasksForList", () => {
  it("omits empty groups and orders groups by display priority", () => {
    const tasks = [
      task({ id: "d", group: "Default" }),
      task({ id: "c", group: "Critical" }),
      task({ id: "p", group: "PastDue" }),
    ];
    const result = groupTasksForList(tasks);
    expect(result.groups.map((g) => g.group)).toEqual<TaskGroup[]>(["PastDue", "Critical", "Default"]);
  });

  it("retains manual array order within a group", () => {
    const tasks = [
      task({ id: "a", group: "Default" }),
      task({ id: "b", group: "Default" }),
      task({ id: "c", group: "Default" }),
    ];
    const result = groupTasksForList(tasks);
    expect(result.groups[0].tasks.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("separates handled tasks and sorts them most-recently-handled first", () => {
    const tasks = [
      task({ id: "p", status: "Pending" }),
      task({ id: "old", status: "Completed", completedAtUtc: "2026-01-01T00:00:00.000Z" }),
      task({ id: "new", status: "Dismissed", completedAtUtc: "2026-03-01T00:00:00.000Z" }),
    ];
    const result = groupTasksForList(tasks);
    expect(result.groups.flatMap((g) => g.tasks.map((t) => t.id))).toEqual(["p"]);
    expect(result.handled.map((t) => t.id)).toEqual(["new", "old"]);
    expect(result.handledTotal).toBe(2);
  });

  it("labels the Default group as 'Tasks'", () => {
    const result = groupTasksForList([task({ id: "a", group: "Default" })]);
    expect(result.groups[0].label).toBe("Tasks");
  });
});

describe("groupTasksForUnifiedView", () => {
  it("sorts each group by creation time, newest first, to interleave files", () => {
    const tasks = [
      task({ id: "a1", sourceFile: "/a.json", createdAtUtc: "2026-01-01T00:00:00.000Z" }),
      task({ id: "b1", sourceFile: "/b.json", createdAtUtc: "2026-02-01T00:00:00.000Z" }),
      task({ id: "a2", sourceFile: "/a.json", createdAtUtc: "2026-03-01T00:00:00.000Z" }),
    ];
    const result = groupTasksForUnifiedView(tasks);
    expect(result.groups[0].tasks.map((t) => t.id)).toEqual(["a2", "b1", "a1"]);
  });
});
