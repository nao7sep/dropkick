import { describe, it, expect } from "vitest";
import { createDefaultSettings } from "../../src/models";
import type { SettingsDto } from "../../src/models";
import {
  parseKickDistances,
  isSettingsDraftDirty,
  stagedSettings,
  type StagedSettings,
} from "../../src/services/settings-draft";

const committed = (): SettingsDto => createDefaultSettings();

// committed defaults to kickDistances [5, 25] -> the matching field string.
const KICK_STRING = "5, 25";

describe("parseKickDistances", () => {
  it("reads a comma-separated list in the typed order, trimming each item", () => {
    expect(parseKickDistances("5, 25")).toEqual({ status: "valid", distances: [5, 25] });
    expect(parseKickDistances("  25 ,5,   10  ")).toEqual({ status: "valid", distances: [25, 5, 10] });
    expect(parseKickDistances("1, 999")).toEqual({ status: "valid", distances: [1, 999] });
  });

  it("reads an empty field as no distances, never as the built-in", () => {
    expect(parseKickDistances("")).toEqual({ status: "valid", distances: [] });
    expect(parseKickDistances("   ")).toEqual({ status: "valid", distances: [] });
  });

  it("skips blank items between commas", () => {
    expect(parseKickDistances("5,, 25,")).toEqual({ status: "valid", distances: [5, 25] });
  });

  it.each(["0", "1000", "-3", "3.9", "abc", "+5", "1e2", "5 5"])("names %j as outside 1 to 999 instead of correcting it", (item) => {
    expect(parseKickDistances(`5, ${item}, 25`)).toEqual({ status: "invalid", item, reason: "range" });
  });

  it("names a repeated item as typed", () => {
    expect(parseKickDistances("5, 25, 05")).toEqual({ status: "invalid", item: "05", reason: "duplicate" });
  });

  it("names the first failing item", () => {
    expect(parseKickDistances("abc, 5, 5")).toEqual({ status: "invalid", item: "abc", reason: "range" });
  });
});

describe("stagedSettings", () => {
  it("stages every preference, theme included, as a fresh copy", () => {
    const c = committed();
    const staged = stagedSettings(c);
    expect(staged).toEqual({ ...c, dueSoonDays: String(c.dueSoonDays), handledTasksPageSize: String(c.handledTasksPageSize) });
    expect(staged).not.toBe(c);
  });
});

describe("isSettingsDraftDirty", () => {
  it("is not dirty when draft equals committed and kick string matches", () => {
    const c = committed();
    expect(isSettingsDraftDirty(stagedSettings(c), c, KICK_STRING)).toBe(false);
  });

  it("is dirty when a staged field changes", () => {
    const c = committed();
    const draft = { ...stagedSettings(c), fontFamily: "Comic Sans" };
    expect(isSettingsDraftDirty(draft, c, KICK_STRING)).toBe(true);
  });

  it("is dirty when the kick string differs from the committed list", () => {
    const c = committed();
    expect(isSettingsDraftDirty(stagedSettings(c), c, "5, 25, 100")).toBe(true);
  });

  it("treats whitespace-only kick differences as dirty (round-trip is the source of truth)", () => {
    // Closing would re-parse and re-serialize; an unequal raw string still
    // counts as a pending edit until Save normalizes it.
    const c = committed();
    expect(isSettingsDraftDirty(stagedSettings(c), c, "5,25")).toBe(true);
  });

  it("is dirty when only the theme changes, since it applies on Save", () => {
    const c = committed();
    const draft = { ...stagedSettings(c), theme: c.theme === "dark" ? "light" as const : "dark" as const };
    expect(isSettingsDraftDirty(draft, c, KICK_STRING)).toBe(true);
  });

  it("detects changes in each staged field", () => {
    const c = committed();
    const cases: Partial<StagedSettings>[] = [
      { timezone: "Asia/Tokyo" },
      { dueSoonDays: String(c.dueSoonDays + 1) },
      { handledTasksPageSize: String(c.handledTasksPageSize + 10) },
      { fontFamily: `${c.fontFamily}-alt` },
      { confirmPermanentDeletions: !c.confirmPermanentDeletions },
    ];
    for (const change of cases) {
      expect(isSettingsDraftDirty({ ...stagedSettings(c), ...change }, c, KICK_STRING)).toBe(
        true,
      );
    }
  });
});

