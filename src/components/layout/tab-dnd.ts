import { rectSortingStrategy } from "@dnd-kit/sortable";
import type { SortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Transform } from "@dnd-kit/utilities";

export interface TabReorderPlan {
  fromIndex: number;
  toIndex: number;
}

// Keyboard reorder follows the focused tab's stable id, never a rendered index
// captured before React or another tab action changed the array. A boundary move
// is a no-op and therefore never reaches the durable reorder operation.
export function planTabReorder(
  tabIds: readonly string[],
  focusedId: string,
  direction: -1 | 1,
): TabReorderPlan | null {
  const fromIndex = tabIds.indexOf(focusedId);
  if (fromIndex === -1) return null;
  const toIndex = fromIndex + direction;
  if (toIndex < 0 || toIndex >= tabIds.length) return null;
  return { fromIndex, toIndex };
}

// Tabs wrap across rows and have different widths. The rectangular strategy
// follows both axes; forcing unit scale keeps dnd-kit from stretching tab text
// and icons to the dimensions of whichever tab currently occupies a slot.
export const wrappedTabSortingStrategy: SortingStrategy = (args) => {
  const transform = rectSortingStrategy(args);
  return transform ? { ...transform, scaleX: 1, scaleY: 1 } : null;
};

// The actively dragged source receives scale from DndContext when it crosses a
// differently sized target. A tab should move with the pointer, never resize.
export function tabDragTransform(transform: Transform | null): string | undefined {
  return CSS.Translate.toString(transform);
}
