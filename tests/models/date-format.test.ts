import { describe, it, expect } from "vitest";
import {
  DATE_FORMATS,
  DEFAULT_DATE_FORMAT,
  isDateFormat,
  coerceDateFormat,
} from "../../src/models/date-format";

describe("isDateFormat", () => {
  it("accepts every supported format", () => {
    for (const fmt of DATE_FORMATS) {
      expect(isDateFormat(fmt)).toBe(true);
    }
  });

  it("rejects moment-style tokens date-fns would throw on", () => {
    // "D" is day-of-year and "YY" is week-numbering year in date-fns; both
    // throw at format() time. These must never be accepted as a stored value.
    expect(isDateFormat("MMM D, YYYY")).toBe(false);
    expect(isDateFormat("D/M/YYYY")).toBe(false);
    expect(isDateFormat("YY-MM-DD")).toBe(false);
    // A format that "looks" supported but isn't exactly one of the presets.
    expect(isDateFormat("YYYY/MM/DD")).toBe(false);
  });

  it("rejects empty and non-string values", () => {
    expect(isDateFormat("")).toBe(false);
    expect(isDateFormat(null)).toBe(false);
    expect(isDateFormat(undefined)).toBe(false);
    expect(isDateFormat(42)).toBe(false);
    expect(isDateFormat({})).toBe(false);
  });
});

describe("coerceDateFormat", () => {
  it("keeps a supported format unchanged", () => {
    expect(coerceDateFormat("YYYY-MM-DD")).toBe("YYYY-MM-DD");
    expect(coerceDateFormat("MM/DD/YYYY")).toBe("MM/DD/YYYY");
    expect(coerceDateFormat("DD/MM/YYYY")).toBe("DD/MM/YYYY");
  });

  it("falls back to the default for unsupported or malformed values", () => {
    expect(coerceDateFormat("MMM D, YYYY")).toBe(DEFAULT_DATE_FORMAT);
    expect(coerceDateFormat("garbage")).toBe(DEFAULT_DATE_FORMAT);
    expect(coerceDateFormat("")).toBe(DEFAULT_DATE_FORMAT);
    expect(coerceDateFormat(null)).toBe(DEFAULT_DATE_FORMAT);
    expect(coerceDateFormat(undefined)).toBe(DEFAULT_DATE_FORMAT);
    expect(coerceDateFormat(123)).toBe(DEFAULT_DATE_FORMAT);
  });

  it("uses a supported format as the default", () => {
    expect(isDateFormat(DEFAULT_DATE_FORMAT)).toBe(true);
  });
});
