import type { Task } from "../models";

const TASK_SELECTION_SEPARATOR = "\u0000";

export interface TaskSelectionIdentity {
  sourceFile: string;
  taskId: string;
}

export function taskSelectionKey(
  task: Pick<Task, "sourceFile" | "id">,
): string {
  return taskKey(task.sourceFile, task.id);
}

export function taskKey(sourceFile: string, taskId: string): string {
  return `${sourceFile}${TASK_SELECTION_SEPARATOR}${taskId}`;
}

export function parseTaskKey(key: string): TaskSelectionIdentity | null {
  const separatorIndex = key.lastIndexOf(TASK_SELECTION_SEPARATOR);
  if (separatorIndex === -1) return null;

  return {
    sourceFile: key.slice(0, separatorIndex),
    taskId: key.slice(separatorIndex + TASK_SELECTION_SEPARATOR.length),
  };
}

// Pick the next active task in visual order after the current selection.
// Returns null at the end of the active list so callers do not follow tasks
// into the handled section after completion or dismissal.
export function pickNextActiveKey(
  selectedKeys: Set<string>,
  visualTasks: Task[],
): string | null {
  if (selectedKeys.size === 0) return null;

  const selectedIndexes = visualTasks
    .map((task, index) =>
      selectedKeys.has(taskSelectionKey(task)) ? index : -1,
    )
    .filter((index) => index !== -1);

  if (selectedIndexes.length === 0) return null;

  const lastSelectedIndex = Math.max(...selectedIndexes);
  const nextTask = visualTasks
    .slice(lastSelectedIndex + 1)
    .find((task) => !selectedKeys.has(taskSelectionKey(task)));

  return nextTask ? taskSelectionKey(nextTask) : null;
}

// DOM id for a task row's listbox option element. Stable per selection key and
// safe as an HTML id (encoding strips whitespace and the NUL separator) so the
// listbox container can point at the active row via aria-activedescendant.
export function rowDomId(selectionKey: string): string {
  return `task-option-${encodeURIComponent(selectionKey)}`;
}

// Move an index by one step, stopping at the ends (no wrap — the list default).
// Returns the same index at a boundary; -1 for an empty list.
export function stepIndex(
  currentIndex: number,
  direction: 1 | -1,
  length: number,
): number {
  if (length === 0) return -1;
  const next = currentIndex + direction;
  if (next < 0 || next >= length) return currentIndex;
  return next;
}

// Move an index by a page, clamped to the list bounds. -1 for an empty list.
export function pageStepIndex(
  currentIndex: number,
  direction: 1 | -1,
  page: number,
  length: number,
): number {
  if (length === 0) return -1;
  const next = currentIndex + direction * page;
  return Math.min(length - 1, Math.max(0, next));
}

// Keys spanning anchor→target inclusive, ordered so the target is last. Used for
// keyboard range extension, where the target becomes the new dominant (last in
// the selection set) item.
export function rangeKeysBetween(
  visualKeys: string[],
  anchorIndex: number,
  targetIndex: number,
): string[] {
  if (anchorIndex < 0 || targetIndex < 0) return [];
  const step = targetIndex >= anchorIndex ? 1 : -1;
  const keys: string[] = [];
  for (
    let i = anchorIndex;
    step === 1 ? i <= targetIndex : i >= targetIndex;
    i += step
  ) {
    const key = visualKeys[i];
    if (key !== undefined) keys.push(key);
  }
  return keys;
}

// What ArrowDown should do in the task listbox, given the cursor position in the
// navigable range and the Handled archive's state. Kept pure so the continuous
// active→Handled navigation (move within range, expand into Handled on entry,
// page in more handled tasks, or stop at the true end) is unit-testable apart
// from the DOM.
export type ListArrowDownPlan =
  | { kind: "select"; index: number }
  | { kind: "expandHandled" }
  | { kind: "showMoreHandled" }
  | { kind: "none" };

export function planListArrowDown(params: {
  currentIndex: number;
  length: number;
  handledExpanded: boolean;
  handledTotal: number;
  handledVisible: number;
}): ListArrowDownPlan {
  const { currentIndex, length, handledExpanded, handledTotal, handledVisible } =
    params;
  if (currentIndex !== -1 && currentIndex < length - 1) {
    return { kind: "select", index: currentIndex + 1 };
  }
  if (currentIndex === -1 && length > 0) {
    return { kind: "select", index: 0 };
  }
  if (!handledExpanded && handledTotal > 0) {
    return { kind: "expandHandled" };
  }
  if (handledExpanded && handledVisible < handledTotal) {
    return { kind: "showMoreHandled" };
  }
  return { kind: "none" };
}

// The selection a Shift+click produces, or null when no range can be formed and
// the caller should fall back to a plain click.
//
// It anchors on the same key Shift+Arrow does and REPLACES the selection, so
// the pointer gesture mirrors the keyboard exactly through one rule
// (composite-control-conventions). Anchoring on the last-inserted key and
// unioning instead made a range able to grow but never shrink: after selecting
// rows 1-5, Shift+clicking row 3 to narrow it took row 5 as the anchor and
// unioned 5..3 back in, leaving 1-5, where Shift+ArrowUp narrows correctly.
//
// The anchor falls back to the last-inserted selected key when no anchor is
// recorded or it has left the visible domain — a collapsed archive, say.
export function planRangeSelection(
  visualKeys: string[],
  anchorKey: string | null,
  selectedKeys: Set<string>,
  clickedKey: string,
): Set<string> | null {
  if (selectedKeys.size === 0) return null;
  const anchor =
    anchorKey && visualKeys.includes(anchorKey)
      ? anchorKey
      : [...selectedKeys].pop();
  if (anchor === undefined) return null;
  const anchorIndex = visualKeys.indexOf(anchor);
  const clickIndex = visualKeys.indexOf(clickedKey);
  if (anchorIndex === -1 || clickIndex === -1) return null;
  return new Set(rangeKeysBetween(visualKeys, anchorIndex, clickIndex));
}
