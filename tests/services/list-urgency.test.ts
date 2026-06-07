import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeListUrgency } from "../../src/services/list-urgency";
import { makeTask } from "../helpers/task";

// computeListUrgency resolves "today" from the system clock via the date
// helpers. Pin it so due-date boundaries are deterministic, and use a fixed UTC
// zone so the host machine's timezone never leaks in.
const TZ = "UTC";
const YESTERDAY = "2026-06-03";
const TODAY = "2026-06-04";
const TOMORROW = "2026-06-05";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("computeListUrgency", () => {
  it("returns null for an empty list", () => {
    expect(computeListUrgency([], TZ)).toBeNull();
  });

  it("returns null when no task carries a due date", () => {
    const tasks = [makeTask({ dueDate: null }), makeTask({ dueDate: null })];
    expect(computeListUrgency(tasks, TZ)).toBeNull();
  });

  it("flags PastDue for an overdue pending task", () => {
    expect(computeListUrgency([makeTask({ dueDate: YESTERDAY })], TZ)).toBe("PastDue");
  });

  it("flags DueToday for a task due today", () => {
    expect(computeListUrgency([makeTask({ dueDate: TODAY })], TZ)).toBe("DueToday");
  });

  it("ignores a future due date", () => {
    expect(computeListUrgency([makeTask({ dueDate: TOMORROW })], TZ)).toBeNull();
  });

  it("PastDue outranks DueToday regardless of array order", () => {
    const dueTodayFirst = [
      makeTask({ dueDate: TODAY }),
      makeTask({ dueDate: YESTERDAY }),
    ];
    const overdueFirst = [
      makeTask({ dueDate: YESTERDAY }),
      makeTask({ dueDate: TODAY }),
    ];
    expect(computeListUrgency(dueTodayFirst, TZ)).toBe("PastDue");
    expect(computeListUrgency(overdueFirst, TZ)).toBe("PastDue");
  });

  it("ignores handled tasks even when overdue or due today", () => {
    const tasks = [
      makeTask({ status: "Completed", dueDate: YESTERDAY }),
      makeTask({ status: "Dismissed", dueDate: TODAY }),
    ];
    expect(computeListUrgency(tasks, TZ)).toBeNull();
  });

  it("considers only pending tasks among mixed statuses", () => {
    const tasks = [
      makeTask({ status: "Completed", dueDate: YESTERDAY }),
      makeTask({ status: "Pending", dueDate: TODAY }),
    ];
    expect(computeListUrgency(tasks, TZ)).toBe("DueToday");
  });

  it("surfaces a deadline regardless of the task's priority", () => {
    // A Critical task that is also due today would group under Critical, but its
    // deadline must still light up the tab.
    const tasks = [makeTask({ priority: "Critical", dueDate: TODAY })];
    expect(computeListUrgency(tasks, TZ)).toBe("DueToday");
  });
});
