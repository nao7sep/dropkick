import { describe, expect, it } from "vitest";
import {
  resolveDarkMode,
  toggledThemePreference,
} from "../../src/utils/theme";

describe("resolveDarkMode", () => {
  it("follows the OS only in System mode", () => {
    expect(resolveDarkMode("system", false)).toBe(false);
    expect(resolveDarkMode("system", true)).toBe(true);
    expect(resolveDarkMode("light", true)).toBe(false);
    expect(resolveDarkMode("dark", false)).toBe(true);
  });
});

describe("toggledThemePreference", () => {
  it("switches explicit modes to the opposite appearance", () => {
    expect(toggledThemePreference("light", false)).toBe("dark");
    expect(toggledThemePreference("dark", true)).toBe("light");
  });

  it("switches System to the opposite of the OS's current appearance", () => {
    expect(toggledThemePreference("system", false)).toBe("dark");
    expect(toggledThemePreference("system", true)).toBe("light");
  });
});
