import { describe, it, expect } from "vitest";
import { summarizeBulkStatusResult, groupMoveBySource } from "../../src/utils/bulk-status";
import type { ActionResult } from "../../src/state";

const ok: ActionResult = { status: "success" };
const skip = (reason: string): ActionResult => ({ status: "validation", reason });
const err = (message: string): ActionResult => ({ status: "error", message });

describe("summarizeBulkStatusResult", () => {
  it("reports no issues when every result succeeds", () => {
    const s = summarizeBulkStatusResult([ok, ok]);
    expect(s.hasIssues).toBe(false);
    expect(s.skippedCount).toBe(0);
    expect(s.firstError).toBeNull();
    expect(s.reasonsText).toBe("");
  });

  it("tallies validation reasons and annotates counts > 1", () => {
    const s = summarizeBulkStatusResult([skip("Blocked"), skip("Blocked"), skip("Overdue")]);
    expect(s.skippedCount).toBe(3);
    expect(s.reasons).toEqual([
      { reason: "Blocked", count: 2 },
      { reason: "Overdue", count: 1 },
    ]);
    // First-seen order; a single occurrence is not annotated.
    expect(s.reasonsText).toBe("Blocked (2 tasks); Overdue");
    expect(s.hasIssues).toBe(true);
  });

  it("captures only the first hard error", () => {
    const s = summarizeBulkStatusResult([ok, err("disk full"), err("permission denied")]);
    expect(s.firstError).toBe("disk full");
    expect(s.hasIssues).toBe(true);
  });

  it("reports both skips and a first error together", () => {
    const s = summarizeBulkStatusResult([skip("Blocked"), err("io"), ok]);
    expect(s.skippedCount).toBe(1);
    expect(s.firstError).toBe("io");
    expect(s.reasonsText).toBe("Blocked");
    expect(s.hasIssues).toBe(true);
  });
});

describe("groupMoveBySource", () => {
  it("groups task ids by their source file", () => {
    const grouped = groupMoveBySource([
      { sourceFile: "a.md", id: "1" },
      { sourceFile: "b.md", id: "2" },
      { sourceFile: "a.md", id: "3" },
    ]);
    expect(grouped.get("a.md")).toEqual(new Set(["1", "3"]));
    expect(grouped.get("b.md")).toEqual(new Set(["2"]));
    expect(grouped.size).toBe(2);
  });

  it("returns an empty map for no tasks", () => {
    expect(groupMoveBySource([]).size).toBe(0);
  });
});
