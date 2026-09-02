import { describe, it, expect } from "vitest";
import { groupMoveBySource } from "../../src/utils/bulk-status";

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
