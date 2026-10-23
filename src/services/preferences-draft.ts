// Settings-modal draft helpers — pure logic kept out of the component so it can
// be unit tested and so the "staged vs. live" split lives in one place.
//
// The Settings modal stages every preference in a local draft and commits them
// together on Save — theme included, so no field applies ahead of the others
// (app-chrome conventions, Theme).
//
// (zoomLevel and sidebarWidth are view state, not preferences — they live in
// AppStateDto / state.json and never reach this draft. See
// persisted-store-separation-conventions.)

import type { PreferencesDto } from "../models";
import { normalizeKickDistances, isValidPreferenceSet } from "../models";

// The preferences the Settings modal stages: everything the user edits and
// commits on Save.
export type StagedPreferences = Omit<PreferencesDto, "dueSoonDays" | "handledTasksPageSize"> & { dueSoonDays: string; handledTasksPageSize: string };

// Projects the committed preferences into a fresh draft.
export function stagedPreferences(
  preferences: PreferencesDto,
): StagedPreferences {
  return { ...preferences, dueSoonDays: String(preferences.dueSoonDays), handledTasksPageSize: String(preferences.handledTasksPageSize) };
}

// Parses the comma-separated kick-distances field into a clean, ordered list.
// Delegates the positive-integer / clamp-to-999 / de-dup / fallback rules to the
// model normalizer for Settings input. Stored load replaces an invalid whole
// set with its built-in value, and persistence refuses invalid sets.
export function parseKickDistances(input: string): number[] {
  return normalizeKickDistances(
    input.split(",").map((value) => parseInt(value.trim(), 10)),
  );
}

// True when the staged draft differs from the committed preferences in any way
// the user would lose by closing. Kick distances are edited as a raw string, so
// they are compared via kickInput rather than the parsed array.
export function isPreferencesDraftDirty(
  draft: StagedPreferences,
  committed: PreferencesDto,
  kickInput: string,
): boolean {
  if (kickInput !== committed.kickDistances.join(", ")) return true;

  return (Object.keys(draft) as (keyof StagedPreferences)[])
    .filter((key) => key !== "kickDistances")
    .some((key) => draft[key] !== (key === "dueSoonDays" || key === "handledTasksPageSize" ? String(committed[key]) : committed[key]));
}

// A transient blank or incomplete numeric entry remains a draft, never a
// fallback value. The stored setting owns the admitted integer range.
export function parseNumericPreference(key: "dueSoonDays" | "handledTasksPageSize", raw: string): number | null {
  if (!raw.trim()) return null;
  const value = Number(raw);
  return isValidPreferenceSet(key, value) ? value : null;
}
