import { describe, expect, it } from "vitest";
import { planTabReorder } from "../../../src/components/layout/tab-dnd";

describe("keyboard tab reorder planning", () => {
  const ids = ["/a.json", "__unified__", "/c.json"];

  it("plans adjacent moves by stable id", () => {
    expect(planTabReorder(ids, "__unified__", -1)).toEqual({
      fromIndex: 1,
      toIndex: 0,
    });
    expect(planTabReorder(ids, "__unified__", 1)).toEqual({
      fromIndex: 1,
      toIndex: 2,
    });
  });

  it("returns no operation at either boundary or for a stale id", () => {
    expect(planTabReorder(ids, "/a.json", -1)).toBeNull();
    expect(planTabReorder(ids, "/c.json", 1)).toBeNull();
    expect(planTabReorder(ids, "/missing.json", 1)).toBeNull();
  });
});
