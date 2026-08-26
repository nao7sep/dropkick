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
      firstError: null,
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
      firstError: "disk full",
    });
    expect(clearTaskDrafts).toHaveBeenCalledOnce();
    expect(clearTaskDrafts).toHaveBeenCalledWith("c");
  });
});
