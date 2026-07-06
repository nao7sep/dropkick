import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the "Automatic backup" help copy in the Settings modal against the
// actual backup behavior, so the text can never drift back into describing a
// feature the app does not have.
//
// The real behavior (services/backup/backupService.ts, App.tsx): the backup
// runs exactly once, at app startup — runBackupInBackground is called a single
// time in the launch flow, with no timer, interval, or scheduler anywhere — and
// the data-backup convention mandates NO prune, rotation, or auto-delete, so
// archives accumulate and are kept indefinitely. Earlier copy claimed the
// backup ran "hourly" and was "pruned automatically"; both were false and are
// the class of misleading user-facing string this guard forbids.
//
// This reads the component source as text (the same approach version.test.ts
// takes for the manifests) rather than rendering it: the strings are static
// descriptive copy with no logic to exercise, and the repo carries no
// component-rendering harness — a text guard pins the invariant without adding
// one.

// `npm test` runs vitest from the repo root, so cwd is the project root.
const SETTINGS_MODAL_SOURCE = readFileSync(
  join(process.cwd(), "src/components/layout/SettingsModal.tsx"),
  "utf8",
);

describe("Settings 'Automatic backup' help copy matches actual behavior", () => {
  // Words that would only appear if the copy described a scheduler or a
  // deleting/rotating retention policy — neither of which exists.
  it.each([
    ["hourly", "the backup runs once at startup, not on a schedule"],
    ["prune", "the convention mandates no prune/rotation/auto-delete"],
    ["rotat", "archives are never rotated"],
    ["automatically delete", "nothing is auto-deleted"],
  ])(
    "does not claim %s (%s)",
    (forbidden) => {
      expect(SETTINGS_MODAL_SOURCE.toLowerCase()).not.toContain(forbidden);
    },
  );

  it("describes the backup as a startup snapshot", () => {
    expect(SETTINGS_MODAL_SOURCE).toContain("Back up task lists at startup");
  });

  it("describes archives as kept, not pruned", () => {
    expect(SETTINGS_MODAL_SOURCE).toContain(
      "kept indefinitely",
    );
  });
});
