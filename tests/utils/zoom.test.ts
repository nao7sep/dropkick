import { describe, it, expect } from "vitest";
import {
  ZOOM_LEVELS,
  ZOOM_DEFAULT,
  ZOOM_MIN,
  ZOOM_MAX,
  stepZoomIn,
  stepZoomOut,
  isZoomIn,
  isZoomOut,
  isZoomReset,
} from "../../src/utils/zoom";

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

function keyEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return { metaKey: false, ctrlKey: false, altKey: false, ...init } as KeyboardEvent;
}

describe("zoom keyboard shortcuts", () => {
  // Each modifier is asserted ALONE — setting both in one event is exactly how
  // a single-modifier regression stays invisible (keyboard-shortcut-conventions).
  it("fires on Cmd (metaKey) for every zoom key", () => {
    expect(isZoomIn(keyEvent({ key: "=", metaKey: true }))).toBe(true);
    expect(isZoomIn(keyEvent({ key: "+", metaKey: true }))).toBe(true);
    expect(isZoomIn(keyEvent({ key: ";", metaKey: true }))).toBe(true);
    expect(isZoomOut(keyEvent({ key: "-", metaKey: true }))).toBe(true);
    expect(isZoomReset(keyEvent({ key: "0", metaKey: true }))).toBe(true);
  });

  it("fires on Ctrl too — both modifiers are bound on every platform", () => {
    expect(isZoomIn(keyEvent({ key: "=", ctrlKey: true }))).toBe(true);
    expect(isZoomIn(keyEvent({ key: "+", ctrlKey: true }))).toBe(true);
    expect(isZoomIn(keyEvent({ key: ";", ctrlKey: true }))).toBe(true);
    expect(isZoomOut(keyEvent({ key: "-", ctrlKey: true }))).toBe(true);
    expect(isZoomReset(keyEvent({ key: "0", ctrlKey: true }))).toBe(true);
  });

  it("rejects AltGr chords — Windows delivers AltGr as Ctrl+Alt", () => {
    // e.g. Hungarian AltGr+comma types ";" — a zoom-in key — and must keep
    // typing the character instead of zooming and swallowing it.
    expect(isZoomIn(keyEvent({ key: ";", ctrlKey: true, altKey: true }))).toBe(false);
    expect(isZoomIn(keyEvent({ key: "=", ctrlKey: true, altKey: true }))).toBe(false);
    expect(isZoomOut(keyEvent({ key: "-", ctrlKey: true, altKey: true }))).toBe(false);
    expect(isZoomReset(keyEvent({ key: "0", ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("ignores zoom keys without the primary modifier", () => {
    expect(isZoomIn(keyEvent({ key: "=" }))).toBe(false);
    expect(isZoomOut(keyEvent({ key: "-" }))).toBe(false);
    expect(isZoomReset(keyEvent({ key: "0" }))).toBe(false);
  });
});
