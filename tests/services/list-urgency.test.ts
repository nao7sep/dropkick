import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeListUrgency, computeTabUrgencies } from "../../src/services/list-urgency";
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

  it("honors the timezone when resolving the deadline boundary", () => {
    // Pin the instant locally so the assertion can't silently rest on the
    // suite-wide clock: at 12:00Z the UTC date is 2026-06-04, but Kiritimati
    // (UTC+14) has already rolled to 2026-06-05, so a task due 2026-06-04 is due
    // today in UTC yet overdue there. This proves the timezone argument is
    // actually applied rather than the system/UTC date.
    vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"));
    const tasks = [makeTask({ dueDate: "2026-06-04" })];
    expect(computeListUrgency(tasks, "UTC")).toBe("DueToday");
    expect(computeListUrgency(tasks, "Pacific/Kiritimati")).toBe("PastDue");
  });
});

describe("computeTabUrgencies", () => {
  it("omits the unified-view tab — it never shows a dot", () => {
    const tabs = [{ isUnifiedView: true, filePath: "" }];
    expect(computeTabUrgencies(tabs, {}, new Set(), TZ)).toEqual({});
  });

  it("resolves a not-yet-loaded tab to null (no file entry)", () => {
    const tabs = [{ isUnifiedView: false, filePath: "/a.json" }];
    expect(computeTabUrgencies(tabs, {}, new Set(), TZ)["/a.json"]).toBeNull();
  });

  it("resolves a load-errored tab to null even if a stale file entry exists", () => {
    const tabs = [{ isUnifiedView: false, filePath: "/a.json" }];
    const files = { "/a.json": { data: { tasks: [makeTask({ dueDate: YESTERDAY })] } } };
    const errors = new Set(["/a.json"]);
    expect(computeTabUrgencies(tabs, files, errors, TZ)["/a.json"]).toBeNull();
  });

  it("computes per-tab urgency from each loaded file and skips unified view", () => {
    const tabs = [
      { isUnifiedView: false, filePath: "/past.json" },
      { isUnifiedView: false, filePath: "/today.json" },
      { isUnifiedView: false, filePath: "/clear.json" },
      { isUnifiedView: true, filePath: "" },
    ];
    const files = {
      "/past.json": { data: { tasks: [makeTask({ dueDate: YESTERDAY })] } },
      "/today.json": { data: { tasks: [makeTask({ dueDate: TODAY })] } },
      "/clear.json": { data: { tasks: [makeTask({ dueDate: TOMORROW })] } },
    };
    expect(computeTabUrgencies(tabs, files, new Set(), TZ)).toEqual({
      "/past.json": "PastDue",
      "/today.json": "DueToday",
      "/clear.json": null,
    });
  });
});
