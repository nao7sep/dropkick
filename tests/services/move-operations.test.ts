import { describe, it, expect } from "vitest";
import { prepareMoveOperation } from "../../src/services/move-operations";
import { makeTask, ids } from "../helpers/task";

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
