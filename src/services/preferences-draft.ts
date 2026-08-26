// Settings-modal draft helpers — pure logic kept out of the component so it can
// be unit tested and so the "staged vs. live" split lives in one place.
//
// The Settings modal stages most preferences in a local draft and commits them
// on Save. Theme is not one of them: the selector and the global
// Cmd/Ctrl+Shift+D shortcut both write the store directly, so it applies
// immediately and closing the modal never discards it.
//
// That split used to be a runtime list of "live-applied keys" that the dirty
// check filtered out and Save re-affirmed from the store, so a stale draft copy
// could not revert a live change. StagedPreferences expresses it in the type
// instead: theme cannot be in the draft, so there is nothing to filter and
// nothing to re-affirm.
//
// (zoomLevel and sidebarWidth are view state, not preferences — they live in
// AppStateDto / state.json and never reach this draft. See
// persisted-store-separation-conventions.)

import type { PreferencesDto } from "../models";
import { normalizeKickDistances } from "../models";

// The preferences the Settings modal stages. Everything the user edits and
// commits on Save — which is every preference except the one applied live.
export type StagedPreferences = Omit<PreferencesDto, "theme">;

// Projects the committed preferences into a fresh draft.
export function stagedPreferences(
  preferences: PreferencesDto,
): StagedPreferences {
  const { theme: _liveApplied, ...staged } = preferences;
  return staged;
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
// they are compared via kickInput rather than the parsed array.
export function isPreferencesDraftDirty(
  draft: StagedPreferences,
  committed: PreferencesDto,
  kickInput: string,
): boolean {
  if (kickInput !== committed.kickDistances.join(", ")) return true;

  return (Object.keys(draft) as (keyof StagedPreferences)[])
    .filter((key) => key !== "kickDistances")
    .some((key) => draft[key] !== committed[key]);
}
