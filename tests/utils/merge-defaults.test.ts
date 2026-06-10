import { describe, it, expect } from "vitest";
import { mergeWithDefaults } from "../../src/utils/merge-defaults";

interface Shape {
  a: string;
  b: number;
  c: boolean;
  d: string | null;
}

const defaults: Shape = { a: "x", b: 1, c: true, d: "set" };

describe("mergeWithDefaults", () => {
  it("fills missing fields from defaults and keeps supplied ones", () => {
    expect(mergeWithDefaults(defaults, { a: "y" })).toEqual({
      a: "y",
      b: 1,
      c: true,
      d: "set",
    });
  });

  it("keeps falsy stored values like false, 0, and empty string", () => {
    // The projection must not regress to "fall back on anything falsy" — only a
    // missing or null value should defer to the default.
    expect(mergeWithDefaults(defaults, { a: "", b: 0, c: false })).toEqual({
      a: "",
      b: 0,
      c: false,
      d: "set",
    });
  });

  it("treats a stored null as absent and heals to the default", () => {
    // null on a field whose default is non-null is corruption at the load
    // boundary; healing to the default keeps a bad file from poisoning the DTO
    // (e.g. workspace openTabs: null would otherwise crash the startup path).
    expect(mergeWithDefaults(defaults, { d: null })).toEqual({
      a: "x",
      b: 1,
      c: true,
      d: "set",
    });
  });

  it("drops keys that are not part of the shape", () => {
    // Simulates a stored file that still carries a field retired from the type.
    const stored = { a: "y", legacyField: "stale" } as unknown as Partial<Shape>;
    const result = mergeWithDefaults(defaults, stored);
    expect(result).toEqual({ a: "y", b: 1, c: true, d: "set" });
    expect("legacyField" in result).toBe(false);
  });

  it("returns a fresh object without mutating defaults", () => {
    const result = mergeWithDefaults(defaults, { a: "y" });
    expect(result).not.toBe(defaults);
    expect(defaults.a).toBe("x");
  });
});
