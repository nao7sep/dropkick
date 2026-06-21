import { describe, it, expect } from "vitest";
import {
  SIDEBAR_MIN_WIDTH,
  DETAIL_MIN_WIDTH,
  CONTENT_MIN_HEIGHT,
  TAB_BAR_MIN_HEIGHT,
  SPLITTER_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  computeMinWindowWidth,
  computeMinWindowHeight,
  clampSidebarWidth,
} from "../../src/utils/windowSizing";

// Derivation guards: the window minimum must fall out of the pane minimums plus
// the fixed chrome, never a hand-typed literal. If a pane minimum changes, these
// assert the window minimum tracks it automatically.
describe("window minimum size derivation", () => {
  it("derives the min width from sidebar + splitter + detail", () => {
    expect(computeMinWindowWidth()).toBe(
      SIDEBAR_MIN_WIDTH + SPLITTER_WIDTH + DETAIL_MIN_WIDTH,
    );
  });

  it("derives the min height from the tab bar + content", () => {
    expect(computeMinWindowHeight()).toBe(TAB_BAR_MIN_HEIGHT + CONTENT_MIN_HEIGHT);
  });

  it("reserves both panes and the splitter in the width — not just one pane", () => {
    // The binding width dimension is the summed content row, so the min must
    // exceed either pane alone.
    expect(computeMinWindowWidth()).toBeGreaterThan(SIDEBAR_MIN_WIDTH);
    expect(computeMinWindowWidth()).toBeGreaterThan(DETAIL_MIN_WIDTH);
  });

  it("reserves the fixed tab-bar chrome in the height", () => {
    expect(computeMinWindowHeight()).toBeGreaterThan(CONTENT_MIN_HEIGHT);
  });
});

// The sidebar is the ADJUSTABLE pane: a fixed pixel width set by dragging. Its
// persisted INTENT (pixels) is clamped to what the current container can DISPLAY,
// `clamp(SIDEBAR_MIN, intent, maxFit)` where maxFit = container - DETAIL_MIN -
// SPLITTER. The clamp is display-only: the caller persists the unclamped intent.
describe("clampSidebarWidth", () => {
  // A comfortably wide container: enough room for the intent to display in full.
  const WIDE = 1280;
  // maxFit at WIDE — the widest the sidebar can be while the detail pane keeps
  // its own minimum.
  const WIDE_MAX_FIT = WIDE - DETAIL_MIN_WIDTH - SPLITTER_WIDTH;

  it("returns the intent unchanged when the container is wide enough", () => {
    expect(clampSidebarWidth(320, WIDE)).toBe(320);
    expect(clampSidebarWidth(600, WIDE)).toBe(600);
  });

  it("displays a too-wide intent at maxFit while the intent itself is unchanged", () => {
    const intent = WIDE_MAX_FIT + 200; // beyond what the container can show
    const displayed = clampSidebarWidth(intent, WIDE);
    // The displayed width is capped at maxFit...
    expect(displayed).toBe(WIDE_MAX_FIT);
    // ...but the clamp is pure and display-only: it never mutates the intent the
    // caller passed in (which is what gets persisted).
    expect(intent).toBe(WIDE_MAX_FIT + 200);
    expect(displayed).toBeLessThan(intent);
  });

  it("at a narrow container returns a width >= SIDEBAR_MIN and <= maxFit", () => {
    // A container only wide enough for the panes' minimums + splitter: maxFit
    // collapses to exactly SIDEBAR_MIN, so any intent displays there.
    const narrow = SIDEBAR_MIN_WIDTH + DETAIL_MIN_WIDTH + SPLITTER_WIDTH;
    const narrowMaxFit = narrow - DETAIL_MIN_WIDTH - SPLITTER_WIDTH;
    const displayed = clampSidebarWidth(600, narrow);
    expect(displayed).toBeGreaterThanOrEqual(SIDEBAR_MIN_WIDTH);
    expect(displayed).toBeLessThanOrEqual(narrowMaxFit);
    expect(displayed).toBe(SIDEBAR_MIN_WIDTH);
  });

  it("returns to the full intent when the window grows back (intent never changed)", () => {
    // The required behavior: intent 600 displays clamped while small, then
    // returns to exactly 600 once the container is wide enough again.
    const intent = 600;
    const small = SIDEBAR_MIN_WIDTH + DETAIL_MIN_WIDTH + SPLITTER_WIDTH;
    expect(clampSidebarWidth(intent, small)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(intent, WIDE)).toBe(600);
  });

  it("floors a too-small intent at SIDEBAR_MIN (a stale fr like 0.739 clamps up)", () => {
    expect(clampSidebarWidth(0.739, WIDE)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(50, WIDE)).toBe(SIDEBAR_MIN_WIDTH);
  });

  it("falls back to SIDEBAR_MIN when the container is unmeasured", () => {
    expect(clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, 0)).toBe(SIDEBAR_MIN_WIDTH);
  });
});
