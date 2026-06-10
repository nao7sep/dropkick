import { describe, it, expect } from "vitest";
import {
  normalizeKickDistances,
  createDefaultPreferences,
  DEFAULT_KICK_DISTANCES,
} from "../../src/models";

describe("normalizeKickDistances", () => {
  it("keeps a clean array unchanged", () => {
    expect(normalizeKickDistances([5, 25])).toEqual([5, 25]);
  });

  it("preserves order (does not sort)", () => {
    expect(normalizeKickDistances([25, 5, 10])).toEqual([25, 5, 10]);
  });

  it("drops zero, negatives, NaN, and Infinity", () => {
    expect(normalizeKickDistances([0, -3, NaN, Infinity, 5])).toEqual([5]);
  });

  it("truncates floats and clamps to 999", () => {
    expect(normalizeKickDistances([3.9, 1000, 2000])).toEqual([3, 999]);
  });

  it("de-duplicates while keeping first occurrence", () => {
    expect(normalizeKickDistances([5, 5, 25, 5])).toEqual([5, 25]);
  });

  it("falls back to the default pair for empty / non-array / all-invalid input", () => {
    expect(normalizeKickDistances([])).toEqual([5, 25]);
    expect(normalizeKickDistances(undefined)).toEqual([5, 25]);
    expect(normalizeKickDistances("nope")).toEqual([5, 25]);
    expect(normalizeKickDistances([0, -1, NaN])).toEqual([5, 25]);
  });

  it("rejects non-number array entries (hand-edited JSON)", () => {
    expect(normalizeKickDistances([5, "25", null, 10])).toEqual([5, 10]);
  });

  it("returns a fresh copy of the default (no shared mutable reference)", () => {
    const a = normalizeKickDistances([]);
    const b = normalizeKickDistances([]);
    expect(a).toEqual([...DEFAULT_KICK_DISTANCES]);
    expect(a).not.toBe(b);
  });
});

describe("createDefaultPreferences", () => {
  it("uses DEFAULT_KICK_DISTANCES and returns an independent array", () => {
    const a = createDefaultPreferences("A");
    const b = createDefaultPreferences("B");
    expect(a.kickDistances).toEqual([...DEFAULT_KICK_DISTANCES]);
    // Each default object must own its array — no shared module-level reference.
    expect(a.kickDistances).not.toBe(b.kickDistances);
    expect(a.kickDistances).not.toBe(DEFAULT_KICK_DISTANCES);
  });
});
