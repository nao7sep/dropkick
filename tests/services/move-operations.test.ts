import { describe, it, expect } from "vitest";
import {
  prepareMoveOperation,
  moveSelectedTasks,
} from "../../src/services/move-operations";
import { makeTask, ids } from "../helpers/task";
import { taskKey, taskSelectionKey } from "../../src/utils";
import type { Task } from "../../src/models";

describe("prepareMoveOperation", () => {
  it("removes selected tasks from source and prepends them to destination", () => {
    const source = [makeTask({ id: "a" }), makeTask({ id: "b" }), makeTask({ id: "c" })];
    const dest = [makeTask({ id: "x" })];
    const result = prepareMoveOperation(source, dest, ids("a", "c"));

    expect(result.sourceTasks.map((t) => t.id)).toEqual(["b"]);
    expect(result.destinationTasks.map((t) => t.id)).toEqual(["a", "c", "x"]);
  });

  it("preserves the relative order of moved tasks", () => {
    const source = [makeTask({ id: "1" }), makeTask({ id: "2" }), makeTask({ id: "3" }), makeTask({ id: "4" })];
    const result = prepareMoveOperation(source, [], ids("3", "1"));
    expect(result.destinationTasks.map((t) => t.id)).toEqual(["1", "3"]);
  });

  it("leaves both lists effectively unchanged when nothing is selected", () => {
    const source = [makeTask({ id: "a" })];
    const dest = [makeTask({ id: "x" })];
    const result = prepareMoveOperation(source, dest, ids());
    expect(result.sourceTasks.map((t) => t.id)).toEqual(["a"]);
    expect(result.destinationTasks.map((t) => t.id)).toEqual(["x"]);
  });
});

describe("moveSelectedTasks", () => {
  // The partial-failure recovery is the subtlest part of the move path: a
  // unified-view selection can span several files, the store writes one source
  // at a time, and a failure partway leaves some groups already moved. It was
  // written out twice - in the modal and in the bulk actions - and neither copy
  // was reachable from a test.

  const task = (id: string, sourceFile: string): Task =>
    ({ ...makeTask({ id }), sourceFile }) as unknown as Task;

  const ok = async () => ({ status: "success" });

  it("selects the next active task after a single-list move", async () => {
    const outcome = await moveSelectedTasks({
      selectedTasks: [task("a", "/src.json")],
      destination: "/dst.json",
      isUnifiedView: false,
      sourceFilePath: "/src.json",
      nextActiveTaskKey: "next",
      moveTasks: ok,
    });
    expect(outcome.status).toBe("success");
    expect(outcome.selection).toEqual(new Set(["next"]));
  });

  it("keeps moved tasks selected in unified view, where they stay visible", async () => {
    const outcome = await moveSelectedTasks({
      selectedTasks: [task("a", "/x.json"), task("b", "/y.json")],
      destination: "/dst.json",
      isUnifiedView: true,
      sourceFilePath: "",
      nextActiveTaskKey: "next",
      moveTasks: ok,
    });
    expect(outcome.status).toBe("success");
    expect(outcome.selection).toEqual(
      new Set([taskKey("/dst.json", "a"), taskKey("/dst.json", "b")]),
    );
  });

  it("re-keys the groups that landed and leaves the rest, when a later group fails", async () => {
    const calls: string[] = [];
    const outcome = await moveSelectedTasks({
      selectedTasks: [task("a", "/x.json"), task("b", "/y.json")],
      destination: "/dst.json",
      isUnifiedView: true,
      sourceFilePath: "",
      nextActiveTaskKey: null,
      moveTasks: async (source) => {
        calls.push(source);
        return source === "/y.json"
          ? { status: "error", message: "disk full" }
          : { status: "success" };
      },
    });
    expect(calls).toEqual(["/x.json", "/y.json"]);
    expect(outcome.status).toBe("error");
    // "a" landed in the destination; "b" is still where it was.
    expect(outcome.selection).toEqual(
      new Set([taskKey("/dst.json", "a"), taskSelectionKey(task("b", "/y.json"))]),
    );
    // And the user is told some of them moved.
    expect(outcome.message).toContain("Some selected tasks were moved");
    expect(outcome.message).toContain("disk full");
  });

  it("does not claim a partial move when the first group already failed", async () => {
    const outcome = await moveSelectedTasks({
      selectedTasks: [task("a", "/x.json")],
      destination: "/dst.json",
      isUnifiedView: true,
      sourceFilePath: "",
      nextActiveTaskKey: null,
      moveTasks: async () => ({ status: "error", message: "nope" }),
    });
    expect(outcome.status).toBe("error");
    expect(outcome.message).toBe("nope");
    expect(outcome.selection).toEqual(
      new Set([taskSelectionKey(task("a", "/x.json"))]),
    );
  });

  it("keeps the selection intact when a single-list move fails", async () => {
    const outcome = await moveSelectedTasks({
      selectedTasks: [task("a", "/src.json")],
      destination: "/dst.json",
      isUnifiedView: false,
      sourceFilePath: "/src.json",
      nextActiveTaskKey: "next",
      moveTasks: async () => ({ status: "error", message: "boom" }),
    });
    expect(outcome.status).toBe("error");
    expect(outcome.selection).toEqual(
      new Set([taskSelectionKey(task("a", "/src.json"))]),
    );
  });
});
