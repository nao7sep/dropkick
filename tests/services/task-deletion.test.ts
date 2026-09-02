import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../src/models";
import { deleteSelectedTasks } from "../../src/services/task-deletion";
import { makeTask } from "../helpers/task";

function task(id: string, sourceFile: string): Task {
  return { ...makeTask({ id }), sourceFile } as unknown as Task;
}

describe("deleteSelectedTasks", () => {
  it("writes once per source list and clears every successful task's drafts", async () => {
    const removeTasks = vi.fn(async () => ({
      status: "success" as const,
      changed: true,
    }));
    const clearTaskDrafts = vi.fn();
    const selectedTasks = [
      task("a", "/one.json"),
      task("b", "/one.json"),
      task("c", "/two.json"),
    ];

    const result = await deleteSelectedTasks({
      selectedTasks,
      removeTasks,
      clearTaskDrafts,
    });

    expect(removeTasks).toHaveBeenCalledTimes(2);
    expect(removeTasks).toHaveBeenNthCalledWith(
      1,
      "/one.json",
      new Set(["a", "b"]),
    );
    expect(removeTasks).toHaveBeenNthCalledWith(
      2,
      "/two.json",
      new Set(["c"]),
    );
    expect(clearTaskDrafts.mock.calls.map(([id]) => id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(result).toEqual({
      deletedTasks: selectedTasks,
      failedTasks: [],
      failures: [],
    });
  });

  it("keeps a failed source's tasks and drafts while other sources succeed", async () => {
    const removeTasks = vi
      .fn()
      .mockResolvedValueOnce({ status: "error", message: "disk full" })
      .mockResolvedValueOnce({ status: "success", changed: true });
    const clearTaskDrafts = vi.fn();
    const failed = [task("a", "/one.json"), task("b", "/one.json")];
    const deleted = task("c", "/two.json");

    const result = await deleteSelectedTasks({
      selectedTasks: [...failed, deleted],
      removeTasks,
      clearTaskDrafts,
    });

    expect(result).toEqual({
      deletedTasks: [deleted],
      failedTasks: failed,
      failures: failed.map((task) => ({ task, reason: "disk full" })),
    });
    expect(clearTaskDrafts).toHaveBeenCalledOnce();
    expect(clearTaskDrafts).toHaveBeenCalledWith("c");
  });

  it("keeps each failed task with its own source failure", async () => {
    const removeTasks = vi
      .fn()
      .mockResolvedValueOnce({ status: "error", message: "First disk full" })
      .mockResolvedValueOnce({ status: "error", message: "Second read-only" });
    const first = task("a", "/one.json");
    const second = task("b", "/two.json");

    const result = await deleteSelectedTasks({
      selectedTasks: [first, second],
      removeTasks,
      clearTaskDrafts: vi.fn(),
    });

    expect(result.failures).toEqual([
      { task: first, reason: "First disk full" },
      { task: second, reason: "Second read-only" },
    ]);
  });
});
