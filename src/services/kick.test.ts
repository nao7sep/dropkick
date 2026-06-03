import { describe, it, expect } from "vitest";
import {
  sendTasksToFirst,
  sendTasksToLast,
  kickTasks,
  moveTasksUp,
  moveTasksDown,
  dropkickTasks,
} from "./kick";
import { makeTask, ids } from "../../test/helpers/task";

// All kick operations are slot-based: a group's tasks occupy fixed indices in the
// flat array, and reordering only shuffles which task sits in which of *those*
// slots. Tasks in other groups must never move. Most tests below use
// Default-priority, no-due-date tasks (all in the "Default" group) unless they
// specifically exercise cross-group isolation.

const TZ = null;
const DUE_SOON = 7;

// Extract ids in array order, for compact assertions.
const order = (tasks: { id: string }[]) => tasks.map((t) => t.id);

describe("sendTasksToFirst", () => {
  it("moves selected tasks to the front of their group, preserving relative order", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" }), makeTask({ id: "c" }), makeTask({ id: "d" })];
    const result = sendTasksToFirst(tasks, ids("b", "d"), TZ, DUE_SOON);
    expect(order(result)).toEqual(["b", "d", "a", "c"]);
  });

  it("returns the same array reference when nothing is selected", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
    expect(sendTasksToFirst(tasks, ids(), TZ, DUE_SOON)).toBe(tasks);
  });

  it("returns the same array reference for a no-op (already first)", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
    expect(sendTasksToFirst(tasks, ids("a"), TZ, DUE_SOON)).toBe(tasks);
  });
});

describe("sendTasksToLast", () => {
  it("moves selected tasks to the end of their group, preserving relative order", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" }), makeTask({ id: "c" }), makeTask({ id: "d" })];
    const result = sendTasksToLast(tasks, ids("a", "c"), TZ, DUE_SOON);
    expect(order(result)).toEqual(["b", "d", "a", "c"]);
  });

  it("returns the same array reference for a no-op (already last)", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
    expect(sendTasksToLast(tasks, ids("b"), TZ, DUE_SOON)).toBe(tasks);
  });
});

describe("kickTasks", () => {
  it("moves a single task down by the given distance within its group", () => {
    const tasks = ["a", "b", "c", "d", "e"].map((id) => makeTask({ id }));
    const result = kickTasks(tasks, ids("a"), 2, TZ, DUE_SOON);
    expect(order(result)).toEqual(["b", "c", "a", "d", "e"]);
  });

  it("clamps distance to the end of the group", () => {
    const tasks = ["a", "b", "c"].map((id) => makeTask({ id }));
    const result = kickTasks(tasks, ids("a"), 999, TZ, DUE_SOON);
    expect(order(result)).toEqual(["b", "c", "a"]);
  });

  it("keeps a multi-selection contiguous and ordered after the kick", () => {
    const tasks = ["a", "b", "c", "d", "e"].map((id) => makeTask({ id }));
    // a and c selected; distance measured from the first selected task's index.
    const result = kickTasks(tasks, ids("a", "c"), 1, TZ, DUE_SOON);
    // rest = [b, d, e]; insertAfter = min(0+1, 3) = 1 -> [b, (a,c), d, e]
    expect(order(result)).toEqual(["b", "a", "c", "d", "e"]);
  });
});

describe("moveTasksUp / moveTasksDown", () => {
  it("moves a single task up one slot", () => {
    const tasks = ["a", "b", "c"].map((id) => makeTask({ id }));
    expect(order(moveTasksUp(tasks, ids("c"), TZ, DUE_SOON))).toEqual(["a", "c", "b"]);
  });

  it("moves a single task down one slot", () => {
    const tasks = ["a", "b", "c"].map((id) => makeTask({ id }));
    expect(order(moveTasksDown(tasks, ids("a"), TZ, DUE_SOON))).toEqual(["b", "a", "c"]);
  });

  it("does not move past the group edge (no-op returns same reference)", () => {
    const tasks = ["a", "b", "c"].map((id) => makeTask({ id }));
    expect(moveTasksUp(tasks, ids("a"), TZ, DUE_SOON)).toBe(tasks);
    expect(moveTasksDown(tasks, ids("c"), TZ, DUE_SOON)).toBe(tasks);
  });

  it("keeps an adjacent selected block together when moving up", () => {
    const tasks = ["a", "b", "c", "d"].map((id) => makeTask({ id }));
    // b and c are an adjacent selected block; both shift up by one.
    expect(order(moveTasksUp(tasks, ids("b", "c"), TZ, DUE_SOON))).toEqual(["b", "c", "a", "d"]);
  });
});

describe("group isolation", () => {
  it("only reorders within the group that has the selection, leaving other groups untouched", () => {
    const tasks = [
      makeTask({ id: "crit1", priority: "Critical" }),
      makeTask({ id: "def1" }),
      makeTask({ id: "def2" }),
      makeTask({ id: "crit2", priority: "Critical" }),
      makeTask({ id: "def3" }),
    ];
    // Kick def1 down within the Default group; Critical slots (indices 0, 3) stay put.
    const result = kickTasks(tasks, ids("def1"), 1, TZ, DUE_SOON);
    expect(order(result)).toEqual(["crit1", "def2", "def1", "crit2", "def3"]);
    // Critical tasks remain in their original slot positions.
    expect(result[0].id).toBe("crit1");
    expect(result[3].id).toBe("crit2");
  });

  it("reorders each affected group independently for a cross-group selection", () => {
    const tasks = [
      makeTask({ id: "crit1", priority: "Critical" }),
      makeTask({ id: "crit2", priority: "Critical" }),
      makeTask({ id: "def1" }),
      makeTask({ id: "def2" }),
    ];
    // Select one task from each group and send to first within group.
    const result = sendTasksToFirst(tasks, ids("crit2", "def2"), TZ, DUE_SOON);
    expect(order(result)).toEqual(["crit2", "crit1", "def2", "def1"]);
  });

  it("ignores non-Pending tasks when computing slots", () => {
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "done", status: "Completed" }),
      makeTask({ id: "b" }),
    ];
    // Only a and b are Pending Default tasks; the Completed one isn't a slot.
    const result = sendTasksToLast(tasks, ids("a"), TZ, DUE_SOON);
    expect(order(result)).toEqual(["b", "done", "a"]);
  });
});

describe("dropkickTasks", () => {
  it("resets priority and due date, then sends to the end of the Default group", () => {
    const tasks = [
      makeTask({ id: "u", priority: "Urgent", dueDate: "2030-01-01" }),
      makeTask({ id: "d1" }),
      makeTask({ id: "d2" }),
    ];
    const result = dropkickTasks(tasks, ids("u"), TZ, DUE_SOON);
    expect(order(result)).toEqual(["d1", "d2", "u"]);
    const moved = result.find((t) => t.id === "u")!;
    expect(moved.priority).toBe("Default");
    expect(moved.dueDate).toBeNull();
  });

  it("bumps updatedAtUtc only when fields actually change", () => {
    const original = makeTask({ id: "x", priority: "Default", dueDate: null, updatedAtUtc: "2020-01-01T00:00:00.000Z" });
    const tasks = [makeTask({ id: "a" }), original];
    const result = dropkickTasks(tasks, ids("x"), TZ, DUE_SOON);
    const moved = result.find((t) => t.id === "x")!;
    // Already Default + no due date => no field change => timestamp preserved.
    expect(moved.updatedAtUtc).toBe("2020-01-01T00:00:00.000Z");
  });

  it("inserts after the last pending task when no Default-group tasks exist", () => {
    const tasks = [
      makeTask({ id: "c1", priority: "Critical" }),
      makeTask({ id: "c2", priority: "Critical" }),
    ];
    // c2 dropkicked becomes Default and, with no other Default tasks, lands last.
    const result = dropkickTasks(tasks, ids("c2"), TZ, DUE_SOON);
    expect(order(result)).toEqual(["c1", "c2"]);
    expect(result.find((t) => t.id === "c2")!.priority).toBe("Default");
  });

  it("returns the same array reference when nothing is selected", () => {
    const tasks = [makeTask({ id: "a" })];
    expect(dropkickTasks(tasks, ids(), TZ, DUE_SOON)).toBe(tasks);
  });
});
