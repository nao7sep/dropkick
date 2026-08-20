import { describe, it, expect } from "vitest";
import {
  taskKey,
  taskSelectionKey,
  parseTaskKey,
  pickNextActiveKey,
  rowDomId,
  stepIndex,
  pageStepIndex,
  rangeKeysBetween,
  planListArrowDown,
  planRangeSelection,
} from "../../src/utils/selection";
import { makeTask } from "../helpers/task";
import type { Task } from "../../src/models";

function visualTask(id: string, sourceFile: string): Task {
  return {
    ...makeTask({ id }),
    hasActionableNotes: false,
    canComplete: true,
    isOverdue: false,
    isDueToday: false,
    group: "Default",
    sourceFile,
  };
}

describe("taskKey / parseTaskKey", () => {
  it("round-trips a source file and task id", () => {
    const key = taskKey("/path/to/list.json", "abc123");
    expect(parseTaskKey(key)).toEqual({ sourceFile: "/path/to/list.json", taskId: "abc123" });
  });

  it("round-trips even when the source file path contains separators-like chars", () => {
    // The separator is \0 (NUL), which never appears in real paths/ids;
    // a path with colons/slashes must still parse correctly.
    const key = taskKey("C:\\Users\\x\\list.json", "id-1");
    expect(parseTaskKey(key)).toEqual({ sourceFile: "C:\\Users\\x\\list.json", taskId: "id-1" });
  });

  it("taskSelectionKey matches taskKey for the same task", () => {
    const task = visualTask("t1", "/a.json");
    expect(taskSelectionKey(task)).toBe(taskKey("/a.json", "t1"));
  });

  it("returns null for a string without the separator", () => {
    expect(parseTaskKey("not-a-key")).toBeNull();
  });
});

describe("pickNextActiveKey", () => {
  const tasks = [
    visualTask("a", "/f.json"),
    visualTask("b", "/f.json"),
    visualTask("c", "/f.json"),
  ];

  it("returns the next unselected task after the last selected one", () => {
    const selected = new Set([taskKey("/f.json", "a")]);
    expect(pickNextActiveKey(selected, tasks)).toBe(taskKey("/f.json", "b"));
  });

  it("skips over a contiguous selected block to the next free task", () => {
    const selected = new Set([taskKey("/f.json", "a"), taskKey("/f.json", "b")]);
    expect(pickNextActiveKey(selected, tasks)).toBe(taskKey("/f.json", "c"));
  });

  it("returns null at the end of the active list (does not follow into handled)", () => {
    const selected = new Set([taskKey("/f.json", "c")]);
    expect(pickNextActiveKey(selected, tasks)).toBeNull();
  });

  it("returns null when nothing is selected", () => {
    expect(pickNextActiveKey(new Set(), tasks)).toBeNull();
  });

  it("returns null when the selection is not present in the visual list", () => {
    const selected = new Set([taskKey("/other.json", "zzz")]);
    expect(pickNextActiveKey(selected, tasks)).toBeNull();
  });
});

describe("rowDomId", () => {
  it("is stable, whitespace-free, and unique per key", () => {
    const a = rowDomId(taskKey("/my list.json", "id 1"));
    const b = rowDomId(taskKey("/my list.json", "id 2"));
    expect(a).toBe(rowDomId(taskKey("/my list.json", "id 1")));
    expect(a).not.toBe(b);
    expect(a).not.toMatch(/\s/);
  });
});

describe("stepIndex", () => {
  it("moves by one within bounds", () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, -1, 3)).toBe(1);
  });
  it("stops at the ends (no wrap)", () => {
    expect(stepIndex(2, 1, 3)).toBe(2);
    expect(stepIndex(0, -1, 3)).toBe(0);
  });
  it("returns -1 for an empty list", () => {
    expect(stepIndex(0, 1, 0)).toBe(-1);
  });
});

describe("pageStepIndex", () => {
  it("moves by a page, clamped to bounds", () => {
    expect(pageStepIndex(0, 1, 10, 100)).toBe(10);
    expect(pageStepIndex(95, 1, 10, 100)).toBe(99);
    expect(pageStepIndex(3, -1, 10, 100)).toBe(0);
  });
  it("returns -1 for an empty list", () => {
    expect(pageStepIndex(0, 1, 10, 0)).toBe(-1);
  });
});

describe("rangeKeysBetween", () => {
  const keys = ["a", "b", "c", "d"];
  it("returns anchor→target inclusive with target last (downward)", () => {
    expect(rangeKeysBetween(keys, 1, 3)).toEqual(["b", "c", "d"]);
  });
  it("returns anchor→target inclusive with target last (upward)", () => {
    expect(rangeKeysBetween(keys, 3, 1)).toEqual(["d", "c", "b"]);
  });
  it("returns the single key when anchor equals target", () => {
    expect(rangeKeysBetween(keys, 2, 2)).toEqual(["c"]);
  });
  it("returns empty for a negative index", () => {
    expect(rangeKeysBetween(keys, -1, 2)).toEqual([]);
  });
});

describe("planListArrowDown", () => {
  const base = {
    handledExpanded: false,
    handledTotal: 0,
    handledVisible: 0,
  };

  it("moves to the next index within the active range", () => {
    expect(
      planListArrowDown({ ...base, currentIndex: 0, length: 3 }),
    ).toEqual({ kind: "select", index: 1 });
  });

  it("selects the first item when nothing is active yet", () => {
    expect(
      planListArrowDown({ ...base, currentIndex: -1, length: 3 }),
    ).toEqual({ kind: "select", index: 0 });
  });

  it("expands Handled when at the end of the active range and Handled is collapsed", () => {
    expect(
      planListArrowDown({
        currentIndex: 2,
        length: 3,
        handledExpanded: false,
        handledTotal: 5,
        handledVisible: 0,
      }),
    ).toEqual({ kind: "expandHandled" });
  });

  it("expands Handled from an empty active range (only handled tasks exist)", () => {
    expect(
      planListArrowDown({
        currentIndex: -1,
        length: 0,
        handledExpanded: false,
        handledTotal: 4,
        handledVisible: 0,
      }),
    ).toEqual({ kind: "expandHandled" });
  });

  it("pages in more handled tasks at the end when expanded with more available", () => {
    expect(
      planListArrowDown({
        currentIndex: 4,
        length: 5,
        handledExpanded: true,
        handledTotal: 10,
        handledVisible: 2,
      }),
    ).toEqual({ kind: "showMoreHandled" });
  });

  it("stops at the true end (expanded, all handled shown)", () => {
    expect(
      planListArrowDown({
        currentIndex: 6,
        length: 7,
        handledExpanded: true,
        handledTotal: 2,
        handledVisible: 2,
      }),
    ).toEqual({ kind: "none" });
  });

  it("stops at the end when there are no handled tasks", () => {
    expect(
      planListArrowDown({ ...base, currentIndex: 2, length: 3 }),
    ).toEqual({ kind: "none" });
  });
});

describe("planRangeSelection", () => {
  const keys = ["a", "b", "c", "d", "e"];

  it("replaces the selection with the anchor→click range, so a range can shrink", () => {
    // The bug this pins: anchoring on the last-inserted key and unioning made a
    // Shift+click range able to grow but never shrink.
    const selected = new Set(["a", "b", "c", "d", "e"]);
    expect(planRangeSelection(keys, "a", selected, "c")).toEqual(
      new Set(["a", "b", "c"]),
    );
  });

  it("extends from the anchor rather than from the last-inserted key", () => {
    // Insertion order puts "e" last; the anchor is "a", and that is what wins.
    const selected = new Set(["a", "e"]);
    expect(planRangeSelection(keys, "a", selected, "b")).toEqual(
      new Set(["a", "b"]),
    );
  });

  it("ranges backwards as well as forwards", () => {
    expect(planRangeSelection(keys, "d", new Set(["d"]), "b")).toEqual(
      new Set(["d", "c", "b"]),
    );
  });

  it("falls back to the last-inserted key when the anchor left the domain", () => {
    // The anchor can point into a collapsed archive; the gesture still works.
    expect(planRangeSelection(keys, "gone", new Set(["b"]), "d")).toEqual(
      new Set(["b", "c", "d"]),
    );
  });

  it("declines when nothing is selected or the clicked row is not in the domain", () => {
    expect(planRangeSelection(keys, "a", new Set(), "c")).toBeNull();
    expect(planRangeSelection(keys, "a", new Set(["a"]), "zz")).toBeNull();
  });
});
