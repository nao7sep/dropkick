import { rectSortingStrategy } from "@dnd-kit/sortable";
import type { SortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Transform } from "@dnd-kit/utilities";

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
