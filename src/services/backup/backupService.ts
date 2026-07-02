// The startup edge of the backup. Fire-and-forget after the workspace and
// preferences have loaded: it must never delay the window, surface an error to
// the user, or crash. Everything is logged; nothing is thrown.
//
// "Just in case" runs at startup, not shutdown, because startup is the safest
// moment — the on-disk files are whatever the last session flushed, before this
// session can touch them.

import { isTauri } from "@tauri-apps/api/core";
import { appDataRoot, log, toErrorFields } from "../../repositories";
import { usePreferencesStore } from "../../state/preferences-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { runBackup } from "./backupEngine";
import type { BackupInputs } from "./backupCollector";
import type { BackupReport } from "./backupTypes";

// Kicks off a single best-effort backup without blocking the caller. `preferencesPath`
// and `workspacePath` are the currently loaded documents' paths (the store holds
// their ids); the open task lists are read from the workspace's tabs.
export function runBackupInBackground(
  preferencesPath: string,
  workspacePath: string,
): void {
  void runOnce(preferencesPath, workspacePath);
}

async function runOnce(
  preferencesPath: string,
  workspacePath: string,
): Promise<void> {
  try {
    // No Rust core in the browser preview — nothing to back up, no commands.
    if (!isTauri()) {
      return;
    }

    const preferences = usePreferencesStore.getState().preferences;
    if (!preferences.backupEnabled) {
      log.info("backup skipped (disabled)");
      return;
    }

    const workspace = useWorkspaceStore.getState().workspace;
    const taskListPaths = workspace.openTabs
      .filter((tab) => !tab.isUnifiedView && tab.filePath)
      .map((tab) => tab.filePath);

    const inputs: BackupInputs = {
      homeRoot: await appDataRoot(),
      preferences: { path: preferencesPath, id: preferences.id },
      workspace: { path: workspacePath, id: workspace.id },
      taskListPaths,
    };

    logReport(await runBackup(inputs, Date.now()));
  } catch (error) {
    // Final backstop: any unexpected fault stays out of the user's way.
    log.error("startup backup failed", toErrorFields(error));
  }
}

function logReport(report: BackupReport): void {
  for (const skip of report.skips) {
    log.warn("backup skipped file", { path: skip.sourcePath, reason: skip.reason });
  }
  if (report.indexWasReset) {
    log.warn("backup index was reset; ran a full backup");
  }
  if (report.fatal !== null) {
    log.error("backup failed", { reason: report.fatal });
    return;
  }
  if (report.nothingChanged) {
    // The common outcome; at debug so a normal no-op run is silent in production.
    log.debug("backup: nothing changed");
    return;
  }
  log.info("backup created", {
    archive: report.archiveFileName,
    files: report.filesArchived,
    skipped: report.skips.length,
  });
}
