import { describe, it, expect } from "vitest";
import {
  changedSettingSets,
  normalizeThemePreference,
  createDefaultSettings,
  DEFAULT_KICK_DISTANCES,
  isValidSettingSet,
  SETTING_SET_KEYS,
  settingsDocument,
} from "../../src/models";

describe("normalizeThemePreference", () => {
  it("keeps each supported mode", () => {
    expect(normalizeThemePreference("system")).toBe("system");
    expect(normalizeThemePreference("light")).toBe("light");
    expect(normalizeThemePreference("dark")).toBe("dark");
  });

  it("follows the system for absent and invalid settings", () => {
    expect(normalizeThemePreference(undefined)).toBe("system");
    expect(normalizeThemePreference("invalid")).toBe("system");
  });
});

describe("kickDistances set", () => {
  it("admits whole numbers from 1 to 999, each once, in any order, and the empty list", () => {
    for (const value of [[5, 25], [25, 5, 10], [1, 999], []]) {
      expect(isValidSettingSet("kickDistances", value)).toBe(true);
    }
  });

  it("refuses anything else instead of correcting it", () => {
    for (const value of [[0], [-3], [1000], [3.9], [NaN], [Infinity], [5, 5], [5, "25"], [null], "5, 25", undefined]) {
      expect(isValidSettingSet("kickDistances", value)).toBe(false);
    }
  });

  it("writes an empty list as the user's set, not as the built-in", () => {
    expect(settingsDocument({ ...createDefaultSettings(), kickDistances: [] })).toEqual({ kickDistances: [] });
  });
});

describe("createDefaultSettings", () => {
  it("follows the OS theme by default", () => {
    expect(createDefaultSettings().theme).toBe("system");
  });

  it("uses DEFAULT_KICK_DISTANCES and returns an independent array", () => {
    const a = createDefaultSettings();
    const b = createDefaultSettings();
    expect(a.kickDistances).toEqual([...DEFAULT_KICK_DISTANCES]);
    // Each default object must own its array — no shared module-level reference.
    expect(a.kickDistances).not.toBe(b.kickDistances);
    expect(a.kickDistances).not.toBe(DEFAULT_KICK_DISTANCES);
  });

  it("confirms permanent deletions by default", () => {
    expect(createDefaultSettings().confirmPermanentDeletions).toBe(
      true,
    );
  });
});

describe("settingsDocument", () => {
  it("holds an empty map when every set is its built-in, each built-in valid", () => {
    const settings = createDefaultSettings();
    for (const key of SETTING_SET_KEYS) {
      expect(isValidSettingSet(key, settings[key])).toBe(true);
    }
    expect(settingsDocument(settings)).toEqual({});
  });
});

describe("changedSettingSets", () => {
  it("keeps only sets that differ, compared whole, and never document identity", () => {
    const c = createDefaultSettings();
    const draft = { ...c, theme: "dark" as const, id: "other", name: "Other", kickDistances: [...c.kickDistances] };
    expect(changedSettingSets(draft, c)).toEqual({ theme: "dark" });
    expect(changedSettingSets({ kickDistances: [25, 5] }, c)).toEqual({ kickDistances: [25, 5] });
    expect(changedSettingSets({ theme: c.theme }, c)).toEqual({});
  });
});
