// Settings-modal draft helpers — pure logic kept out of the component so it can
// be unit tested and so the "live-applied vs. staged" split lives in one place.
//
// The Settings modal stages most preferences in a local draft and commits them
// on Save. One display setting is instead applied immediately and owned outside
// the draft:
//
//   - darkMode — toggled live by the Settings checkbox and the global
//                Cmd/Ctrl+Shift+D shortcut; both write the store directly.
//
// It never participates in the draft's dirty check (changing it must not arm a
// "discard changes?" prompt) and is re-affirmed from the live store on Save so a
// stale draft copy can never revert it.
//
// (zoomLevel and sidebarWidth were also live-applied here, but they are view
// state, not preferences — they moved to AppConfigDto / state.json and no longer
// pass through the Settings draft at all. See persisted-store-separation-conventions.)

import type { PreferencesDto } from "../models";
import { normalizeKickDistances } from "../models";

// Preference keys applied immediately and controlled outside the Settings draft.
// Excluded from the draft dirty check; re-applied from the live store on Save.
// This is the single source of truth for both: isPreferencesDraftDirty filters
// these out, and liveAppliedPreferences re-affirms exactly these on Save.
export const LIVE_APPLIED_PREFERENCE_KEYS: readonly (keyof PreferencesDto)[] = [
  "darkMode",
];

// Picks the live-applied keys out of a preferences source. handleSave spreads
// this over the staged draft so the current store values win — a stale draft
// snapshot can never revert a dark-mode / zoom / divider change made while the
// modal was open. Driven by LIVE_APPLIED_PREFERENCE_KEYS so the dirty-exclusion
// list and the Save re-affirm list can never drift apart.
export function liveAppliedPreferences(
  source: PreferencesDto,
): Partial<PreferencesDto> {
  return Object.fromEntries(
    LIVE_APPLIED_PREFERENCE_KEYS.map((key) => [key, source[key]]),
  ) as Partial<PreferencesDto>;
}

// Parses the comma-separated kick-distances field into a clean, ordered list.
// Delegates the positive-integer / clamp-to-999 / de-dup / fallback rules to the
// model normalizer so every entry point (file load, flush, this field) agrees.
export function parseKickDistances(input: string): number[] {
  return normalizeKickDistances(
    input.split(",").map((value) => parseInt(value.trim(), 10)),
  );
}

// True when the staged draft differs from the committed preferences in any way
// the user would lose by closing. Kick distances are edited as a raw string, so
// they are compared via kickInput rather than the parsed array; live-applied
// keys are ignored because closing never discards them.
export function isPreferencesDraftDirty(
  draft: PreferencesDto,
  committed: PreferencesDto,
  kickInput: string,
): boolean {
  if (kickInput !== committed.kickDistances.join(", ")) return true;

  return (Object.keys(committed) as (keyof PreferencesDto)[])
    .filter(
      (key) =>
        key !== "kickDistances" &&
        !LIVE_APPLIED_PREFERENCE_KEYS.includes(key),
    )
    .some((key) => draft[key] !== committed[key]);
}
