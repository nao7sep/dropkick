import { describe, it, expect } from "vitest";
import {
  validateTimezone,
  coerceTimezone,
  normalizeTimezoneOrThrow,
  INVALID_TIMEZONE_MESSAGE,
} from "../../src/utils/timezone";

describe("validateTimezone", () => {
  it("treats null/undefined as 'use system timezone'", () => {
    expect(validateTimezone(null)).toEqual({ valid: true, value: null });
    expect(validateTimezone(undefined)).toEqual({ valid: true, value: null });
  });

  it("treats empty/whitespace strings as null", () => {
    expect(validateTimezone("")).toEqual({ valid: true, value: null });
    expect(validateTimezone("   ")).toEqual({ valid: true, value: null });
  });

  it("accepts and canonicalizes a valid IANA zone", () => {
    const result = validateTimezone("Asia/Tokyo");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("Asia/Tokyo");
  });

  it("rejects a non-string value", () => {
    expect(validateTimezone(42)).toEqual({ valid: false, value: null });
  });

  it("rejects an invalid zone string", () => {
    expect(validateTimezone("Not/AZone")).toEqual({ valid: false, value: null });
  });
});

describe("coerceTimezone", () => {
  it("returns the canonical value for a valid zone", () => {
    expect(coerceTimezone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("falls back to null (system) for an invalid zone", () => {
    expect(coerceTimezone("Not/AZone")).toBeNull();
  });
});

describe("normalizeTimezoneOrThrow", () => {
  it("returns the canonical value for a valid zone", () => {
    expect(normalizeTimezoneOrThrow("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("returns null for empty input", () => {
    expect(normalizeTimezoneOrThrow("")).toBeNull();
  });

  it("throws on an invalid zone instead of silently persisting it", () => {
    expect(() => normalizeTimezoneOrThrow("Not/AZone")).toThrow(INVALID_TIMEZONE_MESSAGE);
  });
});
