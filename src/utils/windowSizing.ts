// Window and pane sizing — the single source of truth for the layout's minimum
// dimensions. The window minimum is DERIVED from the pane minimums plus the
// fixed chrome here, never hand-typed, so the window and its content can never
// disagree (window-chrome-conventions: "the window minimum is the sum").
//
// The layout (MainWindow) is a vertical stack: the tab bar (fixed chrome) on
// top, then a horizontal content row of [task list | splitter | detail]. So:
//   min width  = sidebar min + splitter + detail min   (the content row)
//   min height = live chrome + content min             (the stack)
//
// Each constant is a real minimum — the smallest size at which that region's
// content is still useful — not an arbitrary number.

// Task-list (left) pane minimum width, in pixels. Below this, group headers and
// task titles truncate uselessly. The sidebar is the ADJUSTABLE pane: it carries a
// fixed pixel width set by the splitter drag, and this is the floor the displayed
// width is clamped to (clampSidebarWidth) so the sidebar never drops below it.
export const SIDEBAR_MIN_WIDTH = 160;

// Detail (right) pane minimum width, in pixels. The detail view holds the task
// title, metadata row, notes, and the move/action controls; below this the
// controls wrap into an unusable column. The detail pane is the FILL pane
// (`flex-1 min-w-0`), so it carries this real minimum rather than letting a
// widened sidebar squeeze it to nothing; clampSidebarWidth reserves it.
export const DETAIL_MIN_WIDTH = 360;

// Content row minimum height, in pixels — the height the task list / detail
// panes need before their own scroll regions take over.
export const CONTENT_MIN_HEIGHT = 360;

// One tab-row minimum, in pixels. This is the startup fallback before the main
// window measures its actual tab chrome. Once mounted, every wrapped row and
// persistent result strip is included in the reported chrome height.
export const TAB_BAR_MIN_HEIGHT = 40;

// Resize divider width, in pixels. Matches the `w-1` splitter between the panes
// (Tailwind 1 = 0.25rem = 4px).
export const SPLITTER_WIDTH = 4;

// Minimum window width = the content row at its narrowest: both panes at their
// minimums plus the splitter between them.
//
// Scaled by the webview zoom, because every constant above is in CSS pixels
// while the OS minimum is in logical ones. At 200% the layout needs twice the
// logical width, and a minimum fixed at 100% let the window shrink to half of
// what the panes need — pushing the detail pane and its action controls past
// the right edge, for the accessibility user the zoom exists to serve.
export function computeMinWindowWidth(zoomLevel: number): number {
  return Math.ceil(
    (SIDEBAR_MIN_WIDTH + SPLITTER_WIDTH + DETAIL_MIN_WIDTH) * zoomLevel,
  );
}

// Minimum window height = the currently visible tab chrome plus the content
// row at its minimum, scaled by the zoom for the same reason as the width.
export function computeMinWindowHeight(
  zoomLevel: number,
  chromeHeight = TAB_BAR_MIN_HEIGHT,
): number {
  return Math.ceil((chromeHeight + CONTENT_MIN_HEIGHT) * zoomLevel);
}

/** Caps only the OS floor; the complete derived floor stays in the UI viewport. */
export function boundNativeMinimumToClient(
  required: { width: number; height: number },
  usableClient: { width: number; height: number },
): { width: number; height: number } {
  return {
    width: Math.min(required.width, Math.max(1, usableClient.width)),
    height: Math.min(required.height, Math.max(1, usableClient.height)),
  };
}

// Default sidebar intent width, in pixels. The persisted `sidebarWidth` is the
// sidebar's INTENT width — the width the user last dragged it to — in pixels, not
// a proportion. 320 is a comfortable default a touch narrower than the detail
// pane's minimum.
export const DEFAULT_SIDEBAR_WIDTH = 320;

// Clamps the sidebar's intent width to the width it can actually DISPLAY at in the
// current container. This is a display-only clamp — the caller persists the
// unclamped intent and only feeds the clamped result to the layout.
//
//   maxFit = containerWidth - DETAIL_MIN_WIDTH - SPLITTER_WIDTH
//
// is the widest the sidebar can be while the detail pane still meets its own
// minimum. The displayed width is `clamp(SIDEBAR_MIN_WIDTH, intent, maxFit)`:
//   - a wide container returns the intent unchanged;
//   - a narrow container narrows the sidebar toward SIDEBAR_MIN_WIDTH so the
//     layout never breaks, while the stored intent is left alone — when the
//     window grows back, the intent clamps to itself again and the sidebar
//     returns to exactly its intent width.
//
// Pure and unit-tested. A window/container resize recomputes the displayed width
// from the unchanged intent and persists nothing; only a splitter drag changes
// the intent.
export function clampSidebarWidth(intent: number, containerWidth: number): number {
  // Container not yet measured (initial render before the ResizeObserver fires):
  // fall back to the floor rather than emit a width derived from a zero container.
  if (containerWidth <= 0) return SIDEBAR_MIN_WIDTH;
  const maxFit = containerWidth - DETAIL_MIN_WIDTH - SPLITTER_WIDTH;
  // If the container is so narrow that maxFit would dip below the sidebar's own
  // minimum, the window minimum (setMinSize from computeMinWindow*) should have
  // prevented it; still, pin to SIDEBAR_MIN_WIDTH so the result is never below it.
  if (maxFit < SIDEBAR_MIN_WIDTH) return SIDEBAR_MIN_WIDTH;
  return Math.min(Math.max(intent, SIDEBAR_MIN_WIDTH), maxFit);
}
