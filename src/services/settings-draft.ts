// Settings-modal draft helpers — pure logic kept out of the component so it can
// be unit tested and so the "staged vs. live" split lives in one place.
//
// The Settings modal stages every preference in a local draft and commits them
// together on Save — theme included, so no field applies ahead of the others
// (app-chrome conventions, Theme).
//
// (zoomLevel and sidebarWidth are view state, not settings — they live in
// AppStateDto / state.json and never reach this draft. See
// persisted-store-separation-conventions.)

import type { SettingsDto } from "../models";
import { isValidSettingSet, KICK_DISTANCE_MAX, KICK_DISTANCE_MIN } from "../models";

// The settings the Settings modal stages: everything the user edits and
// commits on Save.
export type StagedSettings = Omit<SettingsDto, "dueSoonDays" | "handledTasksPageSize"> & { dueSoonDays: string; handledTasksPageSize: string };

// Projects the committed settings into a fresh draft.
export function stagedSettings(
  settings: SettingsDto,
): StagedSettings {
  return { ...settings, dueSoonDays: String(settings.dueSoonDays), handledTasksPageSize: String(settings.handledTasksPageSize) };
}

// Reads the comma-separated kick-distances field without changing what was
// typed: each item is trimmed and blank items are skipped, and the first item
// that is not a whole number from 1 to 999, or repeats an earlier one, is
// returned as typed so the field's message can name it. An empty field is the
// empty list.
export type KickDistancesInput =
  | { status: "valid"; distances: number[] }
  | { status: "invalid"; item: string; reason: "range" | "duplicate" };

export function parseKickDistances(input: string): KickDistancesInput {
  const distances: number[] = [];
  for (const item of input.split(",").map((value) => value.trim()).filter(Boolean)) {
    const value = /^\d+$/.test(item) ? Number(item) : NaN;
    if (!(value >= KICK_DISTANCE_MIN && value <= KICK_DISTANCE_MAX)) return { status: "invalid", item, reason: "range" };
    if (distances.includes(value)) return { status: "invalid", item, reason: "duplicate" };
    distances.push(value);
  }
  return { status: "valid", distances };
}

// True when the staged draft differs from the committed settings in any way
// the user would lose by closing. Kick distances are edited as a raw string, so
// they are compared via kickInput rather than the parsed array.
export function isSettingsDraftDirty(
  draft: StagedSettings,
  committed: SettingsDto,
  kickInput: string,
): boolean {
  if (kickInput !== committed.kickDistances.join(", ")) return true;

  return (Object.keys(draft) as (keyof StagedSettings)[])
    .filter((key) => key !== "kickDistances")
    .some((key) => draft[key] !== (key === "dueSoonDays" || key === "handledTasksPageSize" ? String(committed[key]) : committed[key]));
}

// A transient blank or incomplete numeric entry remains a draft, never a
// fallback value. The stored setting owns the admitted integer range.
export function parseNumericSetting(key: "dueSoonDays" | "handledTasksPageSize", raw: string): number | null {
  if (!raw.trim()) return null;
  const value = Number(raw);
  return isValidSettingSet(key, value) ? value : null;
}
