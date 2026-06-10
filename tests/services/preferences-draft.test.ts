import { describe, it, expect } from "vitest";
import { createDefaultPreferences } from "../../src/models";
import type { PreferencesDto } from "../../src/models";
import {
  parseKickDistances,
  isPreferencesDraftDirty,
  liveAppliedPreferences,
  LIVE_APPLIED_PREFERENCE_KEYS,
} from "../../src/services/preferences-draft";

const committed = (): PreferencesDto => createDefaultPreferences("Default");

// committed defaults to kickDistances [5, 25] -> the matching field string.
const KICK_STRING = "5, 25";

describe("parseKickDistances", () => {
  it("parses a clean comma-separated list", () => {
    expect(parseKickDistances("5, 25")).toEqual([5, 25]);
  });

  it("trims surrounding whitespace around each value", () => {
    expect(parseKickDistances("  5 ,   25  ")).toEqual([5, 25]);
  });

  it("preserves the entered order (does not sort)", () => {
    expect(parseKickDistances("25, 5, 10")).toEqual([25, 5, 10]);
  });

  it("drops zero, negatives, and non-numeric entries", () => {
    expect(parseKickDistances("0, -3, 5, abc, 25")).toEqual([5, 25]);
  });

  it("de-duplicates while keeping first occurrence", () => {
    expect(parseKickDistances("5, 5, 25, 5")).toEqual([5, 25]);
  });

  it("clamps values above 999 to 999", () => {
    expect(parseKickDistances("1000, 5")).toEqual([999, 5]);
    // Two over-large values collapse to a single 999 after clamping + dedup.
    expect(parseKickDistances("1000, 2000")).toEqual([999]);
  });

  it("truncates decimals via parseInt", () => {
    expect(parseKickDistances("3.9, 5")).toEqual([3, 5]);
  });

  it("falls back to the default pair when nothing valid remains", () => {
    expect(parseKickDistances("")).toEqual([5, 25]);
    expect(parseKickDistances("   ")).toEqual([5, 25]);
    expect(parseKickDistances("abc, -1, 0")).toEqual([5, 25]);
  });

  it("returns a fresh array each call (no shared mutable default)", () => {
    const a = parseKickDistances("");
    const b = parseKickDistances("");
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe("liveAppliedPreferences", () => {
  it("picks exactly the live-applied keys from the source", () => {
    const c = committed();
    c.darkMode = true;
    c.zoomLevel = 1.7;
    c.sidebarWidth = 400;
    const picked = liveAppliedPreferences(c);
    expect(Object.keys(picked).sort()).toEqual(
      [...LIVE_APPLIED_PREFERENCE_KEYS].sort(),
    );
    expect(picked).toEqual({ darkMode: true, zoomLevel: 1.7, sidebarWidth: 400 });
  });

  it("does not include any staged key (so a Save spread cannot revert them)", () => {
    const picked = liveAppliedPreferences(committed());
    for (const key of ["fontFamily", "timezone", "kickDistances", "dueSoonDays"]) {
      expect(key in picked).toBe(false);
    }
  });
});

describe("isPreferencesDraftDirty", () => {
  it("is not dirty when draft equals committed and kick string matches", () => {
    const c = committed();
    expect(isPreferencesDraftDirty({ ...c }, c, KICK_STRING)).toBe(false);
  });

  it("is dirty when a staged field changes", () => {
    const c = committed();
    const draft = { ...c, fontFamily: "Comic Sans" };
    expect(isPreferencesDraftDirty(draft, c, KICK_STRING)).toBe(true);
  });

  it("is dirty when the kick string differs from the committed list", () => {
    const c = committed();
    expect(isPreferencesDraftDirty({ ...c }, c, "5, 25, 100")).toBe(true);
  });

  it("treats whitespace-only kick differences as dirty (round-trip is the source of truth)", () => {
    // Closing would re-parse and re-serialize; an unequal raw string still
    // counts as a pending edit until Save normalizes it.
    const c = committed();
    expect(isPreferencesDraftDirty({ ...c }, c, "5,25")).toBe(true);
  });

  it.each(LIVE_APPLIED_PREFERENCE_KEYS)(
    "is NOT dirty when only the live-applied key %s differs",
    (key) => {
      const c = committed();
      // Flip the live-applied value in the draft only; closing never discards
      // these, so they must not arm the dirty prompt.
      const draft: PreferencesDto = { ...c };
      if (key === "darkMode") draft.darkMode = !c.darkMode;
      else if (key === "zoomLevel") draft.zoomLevel = c.zoomLevel + 0.5;
      else if (key === "sidebarWidth") draft.sidebarWidth = c.sidebarWidth + 100;
      expect(isPreferencesDraftDirty(draft, c, KICK_STRING)).toBe(false);
    },
  );

  it("is dirty when a staged field changes even if a live-applied key also differs", () => {
    const c = committed();
    const draft = { ...c, darkMode: !c.darkMode, dueSoonDays: c.dueSoonDays + 1 };
    expect(isPreferencesDraftDirty(draft, c, KICK_STRING)).toBe(true);
  });

  it("detects changes in each staged field", () => {
    const c = committed();
    const cases: Partial<PreferencesDto>[] = [
      { dateFormat: c.dateFormat === "YYYY-MM-DD" ? "MM/DD/YYYY" : "YYYY-MM-DD" },
      { timeFormat: c.timeFormat === "24h" ? "12h" : "24h" },
      { timezone: "Asia/Tokyo" },
      { dueSoonDays: c.dueSoonDays + 1 },
      { handledTasksPageSize: c.handledTasksPageSize + 10 },
      { backupEnabled: !c.backupEnabled },
    ];
    for (const change of cases) {
      expect(isPreferencesDraftDirty({ ...c, ...change }, c, KICK_STRING)).toBe(
        true,
      );
    }
  });
});
