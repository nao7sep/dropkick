// Automatic backup — creates a zip of all referenced files on app startup
// and every hour while the app is running.
// Backups are stored in ~/.dropkick/backups/<workspace-id>/ and pruned with GFS rotation
// using UTC-aligned sliding windows:
//   - 0–24 hours old: keep one per hour
//   - 1–7 days old: keep one per day
//   - 7–30 days old: keep one per week
//   - Older than 30 days: delete

import { homeDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { withSerial, log, toErrorFields } from "../repositories";
import { usePreferencesStore } from "../state/preferences-store";
import { useWorkspaceStore } from "../state/workspace-store";
import {
  MS_HOUR,
  backupTimestamp,
  resolveEntryNames,
  selectBackupsToPrune,
} from "./backup-rotation";

const BACKUPS_DIR_NAME = "backups";

let backupTimer: ReturnType<typeof setInterval> | null = null;

// Returns the backup subdirectory for a workspace.
// Each workspace gets its own directory keyed by its unique ID
// so that GFS pruning operates independently per workspace.
async function getBackupsDir(workspaceId: string): Promise<string> {
  const home = await homeDir();
  const sep = home.endsWith("/") || home.endsWith("\\") ? "" : "/";
  return `${home}${sep}.dropkick/${BACKUPS_DIR_NAME}/${workspaceId}`;
}

// Creates a backup zip of the given file paths.
//
// Each source file is read inside its per-path serial slot (withSerial) so the
// read is ordered with any in-flight writes for that path. A backup captures
// each file at one moment, never mid-write. The Rust side only zips bytes
// we've already read — it does no filesystem reads of its own.
async function createBackup(
  workspaceId: string,
  preferencesPath: string,
  workspacePath: string,
  taskListPaths: string[],
): Promise<void> {
  // Check if backup is enabled.
  const prefs = usePreferencesStore.getState().preferences;
  if (!prefs.backupEnabled) return;

  const startedAt = Date.now();
  const allPaths = [preferencesPath, workspacePath, ...taskListPaths];
  const sources = [...resolveEntryNames(allPaths)];
  log.info("backup start", { workspaceId, files: sources.length });

  const entries: [string, string][] = [];
  let failed = 0;
  for (const [sourcePath, entryName] of sources) {
    try {
      const content = await withSerial(sourcePath, () =>
        readTextFile(sourcePath),
      );
      entries.push([entryName, content]);
    } catch (e) {
      // Skip files we can't read (deleted, permission denied, etc.). Matches
      // the original best-effort behavior in the previous Rust loop. Each
      // failure is enumerated; the backup still captures whatever it could read.
      failed++;
      log.warn("backup skipped unreadable file", {
        sourcePath,
        ...toErrorFields(e),
      });
    }
  }

  if (entries.length === 0) {
    log.warn("backup produced no entries", { workspaceId, failed });
    return;
  }

  const backupsDir = await getBackupsDir(workspaceId);
  const outputPath = `${backupsDir}/backup-${backupTimestamp(new Date())}.zip`;

  try {
    await invoke<string>("create_backup_from_entries", { entries, outputPath });
  } catch (e) {
    log.error("backup create failed", { outputPath, ...toErrorFields(e) });
    return;
  }
  log.info("backup created", {
    outputPath,
    entries: entries.length,
    failed,
    ms: Date.now() - startedAt,
  });

  await pruneBackups(backupsDir);
}

// GFS pruning using pure UTC timestamps.
// The keep/delete decision lives in selectBackupsToPrune (pure, tested);
// this function only performs the filesystem I/O around it.
async function pruneBackups(backupsDir: string): Promise<void> {
  try {
    const files = await invoke<string[]>("list_directory", {
      path: backupsDir,
    });

    const { deleteList } = selectBackupsToPrune(files, Date.now());
    if (deleteList.length === 0) return;

    const sep =
      backupsDir.endsWith("/") || backupsDir.endsWith("\\") ? "" : "/";
    for (const name of deleteList) {
      await invoke("delete_file", {
        path: `${backupsDir}${sep}${name}`,
      });
      log.debug("backup pruned file", { name });
    }
    log.info("backups pruned", { deleted: deleteList.length });
  } catch (e) {
    log.error("backup prune failed", { backupsDir, ...toErrorFields(e) });
  }
}

// Returns the current task list file paths from the workspace store.
function currentTaskListPaths(): string[] {
  return useWorkspaceStore
    .getState()
    .workspace.openTabs.filter((t) => !t.isUnifiedView && t.filePath)
    .map((t) => t.filePath);
}

// Starts the backup system: creates an immediate backup, then schedules
// periodic backups every hour. Call once after workspace is loaded.
export function startBackupSchedule(
  workspaceId: string,
  preferencesPath: string,
  workspacePath: string,
): void {
  // Immediate backup on startup.
  createBackup(workspaceId, preferencesPath, workspacePath, currentTaskListPaths()).catch((e) =>
    log.error("startup backup failed", toErrorFields(e)),
  );

  // Periodic backups — reads current open tabs each time so new files are included.
  if (backupTimer !== null) {
    clearInterval(backupTimer);
  }
  backupTimer = setInterval(() => {
    createBackup(workspaceId, preferencesPath, workspacePath, currentTaskListPaths()).catch((e) =>
      log.error("periodic backup failed", toErrorFields(e)),
    );
  }, MS_HOUR);
}
