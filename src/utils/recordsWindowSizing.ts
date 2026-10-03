// The Records window's layout sizes: a user-adjustable list pane (the filters
// above the record list), the splitter, and the detail pane, which takes the
// rest. Pane sizing: window-conventions. The window minimum is derived from
// the panes here and handed to the Rust core when the window is built.

import { SPLITTER_WIDTH } from "./windowSizing";

// The list pane's bounds. `min` still fits the two filter selects side by side.
export const RECORDS_LIST_WIDTH = { min: 320, default: 380, max: 640 } as const;

// Below this the detail pane's fields and JSON blocks stop being readable.
export const RECORDS_DETAIL_MIN_WIDTH = 420;

// The filter band: 12px padding above and below the search field and a row of
// selects (two 32px fields, 8px apart), and the line below it.
export const RECORDS_FILTERS_HEIGHT = 12 * 2 + 32 * 2 + 8 + 1;

// A few rows of the list.
export const RECORDS_LIST_MIN_HEIGHT = 160;

// Derived — do not hand-edit.
export const RECORDS_WINDOW_MIN_WIDTH = RECORDS_LIST_WIDTH.min + SPLITTER_WIDTH + RECORDS_DETAIL_MIN_WIDTH;

// Derived — do not hand-edit.
export const RECORDS_WINDOW_MIN_HEIGHT = RECORDS_FILTERS_HEIGHT + RECORDS_LIST_MIN_HEIGHT;

// The list width shown: the intent, clamped to the pane's bounds and to what
// the window leaves once the detail pane has its minimum. Before the window has
// measured (`available` 0) it is the intent within the pane's bounds.
export function clampRecordsListWidth(intent: number, available: number): number {
  const { min, max } = RECORDS_LIST_WIDTH;
  const room = available > 0 ? available - SPLITTER_WIDTH - RECORDS_DETAIL_MIN_WIDTH : max;
  const ceiling = Math.max(min, Math.min(max, room));
  return Math.max(min, Math.min(ceiling, Math.round(intent)));
}
