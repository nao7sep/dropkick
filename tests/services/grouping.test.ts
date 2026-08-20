import { describe, it, expect } from "vitest";
import {
  collectViewTasks,
  groupTasks,
  visualTaskOrder,
} from "../../src/services/grouping";
import { makeTask } from "../helpers/task";
import type { Task, TaskGroup, TabDto, TaskDto } from "../../src/models";

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

describe("groupTasks — list view", () => {
  it("omits empty groups and orders groups by display priority", () => {
    const tasks = [
      task({ id: "d", group: "Default" }),
      task({ id: "c", group: "Critical" }),
      task({ id: "p", group: "PastDue" }),
    ];
    const result = groupTasks(tasks, false);
    expect(result.groups.map((g) => g.group)).toEqual<TaskGroup[]>(["PastDue", "Critical", "Default"]);
  });

  it("retains manual array order within a group", () => {
    const tasks = [
      task({ id: "a", group: "Default" }),
      task({ id: "b", group: "Default" }),
      task({ id: "c", group: "Default" }),
    ];
    const result = groupTasks(tasks, false);
    expect(result.groups[0].tasks.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("separates handled tasks and sorts them most-recently-handled first", () => {
    const tasks = [
      task({ id: "p", status: "Pending" }),
      task({ id: "old", status: "Completed", completedAtUtc: "2026-01-01T00:00:00.000Z" }),
      task({ id: "new", status: "Dismissed", completedAtUtc: "2026-03-01T00:00:00.000Z" }),
    ];
    const result = groupTasks(tasks, false);
    expect(result.groups.flatMap((g) => g.tasks.map((t) => t.id))).toEqual(["p"]);
    expect(result.handled.map((t) => t.id)).toEqual(["new", "old"]);
    expect(result.handledTotal).toBe(2);
  });

  it("labels the Default group as 'Tasks'", () => {
    const result = groupTasks([task({ id: "a", group: "Default" })], false);
    expect(result.groups[0].label).toBe("Tasks");
  });
});

describe("groupTasks — unified view", () => {
  it("sorts each group by creation time, newest first, to interleave files", () => {
    const tasks = [
      task({ id: "a1", sourceFile: "/a.json", createdAtUtc: "2026-01-01T00:00:00.000Z" }),
      task({ id: "b1", sourceFile: "/b.json", createdAtUtc: "2026-02-01T00:00:00.000Z" }),
      task({ id: "a2", sourceFile: "/a.json", createdAtUtc: "2026-03-01T00:00:00.000Z" }),
    ];
    const result = groupTasks(tasks, true);
    expect(result.groups[0].tasks.map((t) => t.id)).toEqual(["a2", "b1", "a1"]);
  });
});

describe("collectViewTasks", () => {
  // These rules used to be written out in each pane, the keyboard handler and
  // the window shell, reachable only by driving React — which is why a change
  // landing in some copies and not others could make the keyboard's "next task"
  // differ from the one the list shows, with nothing to catch it.

  const tab = (filePath: string, isUnifiedView = false): TabDto => ({
    filePath,
    displayName: filePath,
    isUnifiedView,
  });
  const listFile = (tasks: TaskDto[]) => ({
    data: { version: "1.0.0", id: "L", tasks },
  });

  it("returns one file's tasks for a list tab, stamped with its path", () => {
    const files = {
      "/a.json": listFile([makeTask({ id: "a1" })]),
      "/b.json": listFile([makeTask({ id: "b1" })]),
    };
    const result = collectViewTasks(
      files,
      [tab("/a.json"), tab("/b.json")],
      "/a.json",
      false,
      null,
      7,
    );
    expect(result.map((t) => t.id)).toEqual(["a1"]);
    expect(result[0].sourceFile).toBe("/a.json");
  });

  it("returns nothing for a list tab whose file is not loaded", () => {
    expect(
      collectViewTasks({}, [tab("/a.json")], "/a.json", false, null, 7),
    ).toEqual([]);
  });

  it("merges every open list in the unified view, stamping each source path", () => {
    const files = {
      "/a.json": listFile([makeTask({ id: "a1" })]),
      "/b.json": listFile([makeTask({ id: "b1" })]),
    };
    const result = collectViewTasks(
      files,
      [tab("", true), tab("/a.json"), tab("/b.json")],
      "",
      true,
      null,
      7,
    );
    expect(result.map((t) => t.id)).toEqual(["a1", "b1"]);
    expect(result.map((t) => t.sourceFile)).toEqual(["/a.json", "/b.json"]);
  });

  it("skips an open list that is not loaded rather than failing the merge", () => {
    // A list can be missing because its read failed or is still in flight; the
    // rest of the unified view must still render.
    const files = { "/a.json": listFile([makeTask({ id: "a1" })]) };
    const result = collectViewTasks(
      files,
      [tab("", true), tab("/a.json"), tab("/gone.json")],
      "",
      true,
      null,
      7,
    );
    expect(result.map((t) => t.id)).toEqual(["a1"]);
  });
});

describe("visualTaskOrder", () => {
  it("flattens the groups in display order, which is the order the keyboard walks", () => {
    const tasks = [
      task({ id: "d", group: "Default" }),
      task({ id: "p", group: "PastDue" }),
      task({ id: "c", group: "Critical" }),
    ];
    expect(visualTaskOrder(groupTasks(tasks, false)).map((t) => t.id)).toEqual([
      "p",
      "c",
      "d",
    ]);
  });

  it("omits handled tasks, which are not part of the navigable order", () => {
    const tasks = [
      task({ id: "active" }),
      task({ id: "done", status: "Completed" }),
    ];
    expect(visualTaskOrder(groupTasks(tasks, false)).map((t) => t.id)).toEqual([
      "active",
    ]);
  });
});
