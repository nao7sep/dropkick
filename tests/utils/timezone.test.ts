import { describe, it, expect } from "vitest";
import {
  conversionTimeZone,
  normalizeTimeZonePreference,
  SYSTEM_TIME_ZONE,
  timeZoneOptions,
} from "../../src/utils/timezone";

describe("normalizeTimeZonePreference", () => {
  it("keeps the system token and an id the platform knows", () => {
    expect(normalizeTimeZonePreference("system")).toBe(SYSTEM_TIME_ZONE);
    expect(normalizeTimeZonePreference("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it.each([null, undefined, 42, "", "Not/AZone"])("reads %j as the system token", (value) => {
    expect(normalizeTimeZonePreference(value)).toBe(SYSTEM_TIME_ZONE);
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
