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
