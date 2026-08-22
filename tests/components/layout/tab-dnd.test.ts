import { describe, expect, it } from "vitest";
import type { ClientRect } from "@dnd-kit/core";
import {
  tabDragTransform,
  wrappedTabSortingStrategy,
} from "../../../src/components/layout/tab-dnd";

function rect(left: number, top: number, width: number): ClientRect {
  const height = 36;
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

describe("wrapped tab drag geometry", () => {
  it("moves displaced tabs between wrapped rows without scaling their contents", () => {
    const rects = [
      rect(0, 0, 100),
      rect(100, 0, 180),
      rect(0, 40, 80),
    ];

    const transform = wrappedTabSortingStrategy({
      rects,
      activeNodeRect: rects[0],
      activeIndex: 0,
      overIndex: 2,
      index: 2,
    });

    expect(transform).toEqual({
      x: 100,
      y: -40,
      scaleX: 1,
      scaleY: 1,
    });
  });

  it("drops target-size scaling from the actively dragged tab", () => {
    expect(
      tabDragTransform({ x: 23.4, y: 41.6, scaleX: 1.8, scaleY: 0.6 }),
    ).toBe("translate3d(23px, 42px, 0)");
  });
});
