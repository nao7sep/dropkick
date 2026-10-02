import { describe, it, expect } from "vitest";
import {
  conversionTimeZone,
  isKnownTimeZone,
  SYSTEM_TIME_ZONE,
  timeZoneOptions,
} from "../../src/utils/timezone";

describe("isKnownTimeZone", () => {
  it("accepts an id the platform knows", () => {
    expect(isKnownTimeZone("Asia/Tokyo")).toBe(true);
  });

  it.each([null, undefined, 42, "", "Not/AZone", SYSTEM_TIME_ZONE])("rejects %j", (value) => {
    expect(isKnownTimeZone(value)).toBe(false);
  });
});

describe("conversionTimeZone", () => {
  it("converts into a known id and uses the computer's zone otherwise", () => {
    expect(conversionTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(conversionTimeZone(SYSTEM_TIME_ZONE)).toBeUndefined();
    expect(conversionTimeZone("Not/AZone")).toBeUndefined();
  });
});

describe("timeZoneOptions", () => {
  it("never lists the system token as a zone", () => {
    expect(timeZoneOptions(SYSTEM_TIME_ZONE)).not.toContain(SYSTEM_TIME_ZONE);
    expect(timeZoneOptions(SYSTEM_TIME_ZONE)).toContain("UTC");
  });
});
