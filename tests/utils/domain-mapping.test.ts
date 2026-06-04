import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeGroup, toTask, toDto } from "../../src/utils/domain-mapping";
import { makeTask, makeNote } from "../helpers/task";

// computeGroup and the date-based helpers it calls resolve "today" from the
// system clock. Pin it so due-date boundaries are deterministic. Tests use a
// fixed UTC timezone to avoid the host machine's zone leaking in.
const TZ = "UTC";
const DUE_SOON = 7;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("computeGroup precedence ladder", () => {
  it("PastDue wins over everything, even Critical", () => {
    const t = makeTask({ priority: "Critical", dueDate: "2026-06-01" });
    expect(computeGroup(t, TZ, DUE_SOON)).toBe("PastDue");
  });

  it("Critical wins when not past due, regardless of due date", () => {
    const t = makeTask({ priority: "Critical", dueDate: "2030-01-01" });
    expect(computeGroup(t, TZ, DUE_SOON)).toBe("Critical");
  });

  it("DueToday outranks Important and Urgent", () => {
    const t = makeTask({ priority: "Important", dueDate: "2026-06-04" });
    expect(computeGroup(t, TZ, DUE_SOON)).toBe("DueToday");
  });

  it("Important outranks Urgent", () => {
    const t = makeTask({ priority: "Important", dueDate: null });
    expect(computeGroup(t, TZ, DUE_SOON)).toBe("Important");
  });

  it("Urgent outranks the DueSoon lookahead window", () => {
    const t = makeTask({ priority: "Urgent", dueDate: "2026-06-06" });
    expect(computeGroup(t, TZ, DUE_SOON)).toBe("Urgent");
  });

  it("DueSoon elevates a Default task with an imminent due date", () => {
    const t = makeTask({ priority: "Default", dueDate: "2026-06-06" });
    expect(computeGroup(t, TZ, DUE_SOON)).toBe("DueSoon");
  });

  it("Default for a plain task with no due date", () => {
    const t = makeTask({ priority: "Default", dueDate: null });
    expect(computeGroup(t, TZ, DUE_SOON)).toBe("Default");
  });

  it("a far-future Default due date is not DueSoon", () => {
    const t = makeTask({ priority: "Default", dueDate: "2026-12-31" });
    expect(computeGroup(t, TZ, DUE_SOON)).toBe("Default");
  });
});

describe("computeGroup boundaries", () => {
  it("yesterday is PastDue", () => {
    expect(computeGroup(makeTask({ dueDate: "2026-06-03" }), TZ, DUE_SOON)).toBe("PastDue");
  });

  it("today is DueToday, not PastDue", () => {
    expect(computeGroup(makeTask({ dueDate: "2026-06-04" }), TZ, DUE_SOON)).toBe("DueToday");
  });

  it("tomorrow falls into the DueSoon window", () => {
    expect(computeGroup(makeTask({ dueDate: "2026-06-05" }), TZ, DUE_SOON)).toBe("DueSoon");
  });

  it("the last day of the DueSoon window is included", () => {
    // window is tomorrow .. tomorrow + (dueSoonDays - 1) => 06-05 .. 06-11
    expect(computeGroup(makeTask({ dueDate: "2026-06-11" }), TZ, DUE_SOON)).toBe("DueSoon");
  });

  it("the day after the DueSoon window is Default", () => {
    expect(computeGroup(makeTask({ dueDate: "2026-06-12" }), TZ, DUE_SOON)).toBe("Default");
  });

  it("a dueSoonDays of 0 disables the DueSoon window", () => {
    expect(computeGroup(makeTask({ dueDate: "2026-06-05" }), TZ, 0)).toBe("Default");
  });
});

describe("toTask", () => {
  it("computes actionability and completion gating", () => {
    const dto = makeTask({ notes: [makeNote({ actionability: "Actionable" })] });
    const task = toTask(dto, "/file.json", TZ, DUE_SOON);
    expect(task.hasActionableNotes).toBe(true);
    expect(task.canComplete).toBe(false);
    expect(task.sourceFile).toBe("/file.json");
  });

  it("a task with only informational notes can complete", () => {
    const dto = makeTask({ notes: [makeNote({ actionability: "Informational" })] });
    const task = toTask(dto, "/file.json", TZ, DUE_SOON);
    expect(task.hasActionableNotes).toBe(false);
    expect(task.canComplete).toBe(true);
  });

  it("computes overdue / due-today flags and group", () => {
    const dto = makeTask({ dueDate: "2026-06-04" });
    const task = toTask(dto, "/f", TZ, DUE_SOON);
    expect(task.isOverdue).toBe(false);
    expect(task.isDueToday).toBe(true);
    expect(task.group).toBe("DueToday");
  });
});

describe("toDto", () => {
  it("strips computed properties and preserves DTO key order", () => {
    const dto = makeTask({ id: "x", dueDate: "2026-06-04", notes: [makeNote()] });
    const task = toTask(dto, "/f", TZ, DUE_SOON);
    const roundTripped = toDto(task);

    expect(roundTripped).not.toHaveProperty("group");
    expect(roundTripped).not.toHaveProperty("sourceFile");
    expect(roundTripped).not.toHaveProperty("canComplete");
    expect(roundTripped).toEqual(dto);
    expect(Object.keys(roundTripped)).toEqual([
      "id",
      "title",
      "description",
      "status",
      "priority",
      "dueDate",
      "createdAtUtc",
      "updatedAtUtc",
      "completedAtUtc",
      "notes",
    ]);
  });
});
