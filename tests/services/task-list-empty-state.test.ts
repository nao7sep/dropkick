import { describe, expect, it } from "vitest";
import type { GroupedTasks } from "../../src/services";
import { taskListEmptyMessage } from "../../src/services";

function grouped(activeGroups: number, handledTotal: number): GroupedTasks {
  return {
    groups: Array.from({ length: activeGroups }, () => ({
      group: "Default",
      label: "Tasks",
      tasks: [],
    })),
    handled: [],
    handledTotal,
  };
}

describe("taskListEmptyMessage", () => {
  it("describes a genuinely empty task list", () => {
    expect(taskListEmptyMessage(grouped(0, 0), false)).toBe("No tasks yet.");
  });

  it("describes the blank active body when handled tasks are folded", () => {
    expect(taskListEmptyMessage(grouped(0, 3), false)).toBe("No active tasks.");
  });

  it("shows no empty message while handled rows are expanded", () => {
    expect(taskListEmptyMessage(grouped(0, 3), true)).toBeNull();
  });

  it("shows no empty message while an active group is visible", () => {
    expect(taskListEmptyMessage(grouped(1, 3), false)).toBeNull();
  });

  it("returns to the genuine empty state after the final handled task is removed", () => {
    expect(taskListEmptyMessage(grouped(0, 1), false)).toBe("No active tasks.");
    expect(taskListEmptyMessage(grouped(0, 0), false)).toBe("No tasks yet.");
  });
});
