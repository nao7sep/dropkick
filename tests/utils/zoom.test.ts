import { describe, it, expect, afterEach, vi } from "vitest";
import {
  ZOOM_LEVELS,
  ZOOM_DEFAULT,
  ZOOM_MIN,
  ZOOM_MAX,
  stepZoomIn,
  stepZoomOut,
} from "../../src/utils/zoom";
import { importWithPlatform } from "../helpers/platform";

describe("zoom level stepping", () => {
  it("exposes sane constants", () => {
    expect(ZOOM_DEFAULT).toBe(1.0);
    expect(ZOOM_MIN).toBe(ZOOM_LEVELS[0]);
    expect(ZOOM_MAX).toBe(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
  });

  it("steps up to the next discrete level", () => {
    expect(stepZoomIn(1.0)).toBe(1.2);
  });

  it("steps down to the previous discrete level", () => {
    expect(stepZoomOut(1.0)).toBe(0.9);
  });

  it("snaps an off-list value to the nearest level before stepping", () => {
    // 1.05 snaps to 1.0, then steps up to 1.2.
    expect(stepZoomIn(1.05)).toBe(1.2);
    // 0.95 snaps to 0.9 (closer than 1.0), then steps down to 0.8.
    expect(stepZoomOut(0.95)).toBe(0.8);
  });

  it("clamps at the maximum when stepping in", () => {
    expect(stepZoomIn(ZOOM_MAX)).toBe(ZOOM_MAX);
    expect(stepZoomIn(999)).toBe(ZOOM_MAX);
  });

  it("clamps at the minimum when stepping out", () => {
    expect(stepZoomOut(ZOOM_MIN)).toBe(ZOOM_MIN);
    expect(stepZoomOut(0.01)).toBe(ZOOM_MIN);
  });
});

// Type for the dynamically re-imported module under a stubbed platform.
type ZoomModule = typeof import("../../src/utils/zoom");

function keyEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return init as KeyboardEvent;
}

describe("zoom keyboard shortcuts (platform-dependent)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("on macOS, requires Cmd (metaKey) for zoom keys", async () => {
    const { isZoomIn, isZoomOut, isZoomReset } = await importWithPlatform<ZoomModule>("mac", () => import("../../src/utils/zoom"));
    expect(isZoomIn(keyEvent({ key: "=", metaKey: true }))).toBe(true);
    expect(isZoomIn(keyEvent({ key: "+", metaKey: true }))).toBe(true);
    expect(isZoomIn(keyEvent({ key: ";", metaKey: true }))).toBe(true);
    expect(isZoomOut(keyEvent({ key: "-", metaKey: true }))).toBe(true);
    expect(isZoomReset(keyEvent({ key: "0", metaKey: true }))).toBe(true);
    // Ctrl must NOT trigger on macOS.
    expect(isZoomIn(keyEvent({ key: "=", ctrlKey: true }))).toBe(false);
  });

  it("on Windows, requires Ctrl for zoom keys", async () => {
    const { isZoomIn, isZoomOut, isZoomReset } = await importWithPlatform<ZoomModule>("windows", () => import("../../src/utils/zoom"));
    expect(isZoomIn(keyEvent({ key: "=", ctrlKey: true }))).toBe(true);
    expect(isZoomOut(keyEvent({ key: "-", ctrlKey: true }))).toBe(true);
    expect(isZoomReset(keyEvent({ key: "0", ctrlKey: true }))).toBe(true);
    // Cmd must NOT trigger on Windows.
    expect(isZoomIn(keyEvent({ key: "=", metaKey: true }))).toBe(false);
  });

  it("ignores zoom keys without the primary modifier", async () => {
    const { isZoomIn } = await importWithPlatform<ZoomModule>("mac", () => import("../../src/utils/zoom"));
    expect(isZoomIn(keyEvent({ key: "=" }))).toBe(false);
  });
});
