// Reads and writes task list JSON files with hash-based integrity checks.
// Every write verifies the file hasn't been modified externally since last load.

import type { TaskListDto, TaskDto } from "../models";
import { createEmptyTaskList } from "../models";
import {
  readJsonFileWithHash,
  writeJsonFile,
  hashFile,
  fileExists,
} from "./file-system";

// Represents a loaded task list along with its integrity hash.
export interface LoadedTaskList {
  filePath: string;
  data: TaskListDto;
  hash: string; // SHA-256 of file content at load time
}

export type LoadTaskListResult =
  | { status: "success"; taskList: LoadedTaskList }
  | { status: "missing" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

export type WriteResult =
  | { status: "success"; newHash: string }
  | { status: "conflict" } // file was modified externally
  | { status: "deleted" } // file was deleted
  | { status: "error"; message: string };

// Loads a task list file from disk with its content hash.
export async function loadTaskList(
  filePath: string,
): Promise<LoadTaskListResult> {
  const loaded = await readJsonFileWithHash<TaskListDto>(filePath);
  if (loaded.status !== "success") return loaded;
  return {
    status: "success",
    taskList: { filePath, data: loaded.data, hash: loaded.hash },
  };
}

// Creates a new empty task list file on disk and returns the loaded result.
export async function createTaskListFile(
  filePath: string,
): Promise<LoadedTaskList> {
  const data = createEmptyTaskList();
  await writeJsonFile(filePath, data);
  const hash = await hashFile(filePath);
  return { filePath, data, hash: hash! };
}

// Writes a task list to disk with integrity check.
// Compares the current file hash against the stored hash to detect external modifications.
export async function writeTaskList(
  filePath: string,
  data: TaskListDto,
  expectedHash: string,
): Promise<WriteResult> {
  try {
    // Check if file still exists.
    if (!(await fileExists(filePath))) {
      return { status: "deleted" };
    }

    // Hash the current file on disk.
    const currentHash = await hashFile(filePath);
    if (currentHash === null) {
      return { status: "deleted" };
    }

    // Compare hashes.
    if (currentHash !== expectedHash) {
      return { status: "conflict" };
    }

    // Safe to write.
    await writeJsonFile(filePath, data);

    // Get the new hash after writing.
    const newHash = await hashFile(filePath);
    return { status: "success", newHash: newHash! };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

// Force-writes a task list to disk without hash check.
// Used when the user explicitly chooses to overwrite after a conflict.
export async function forceWriteTaskList(
  filePath: string,
  data: TaskListDto,
): Promise<{ hash: string }> {
  await writeJsonFile(filePath, data);
  const hash = await hashFile(filePath);
  return { hash: hash! };
}

// Executes a two-file move with rollback on source-side failure.
// Writes destination first, then source, and restores the destination if the
// source update fails after the destination has already been written.
async function rollbackDestinationWrite(
  destFilePath: string,
  destOriginalTasks: TaskDto[],
  movedDestHash: string,
  cause: string,
): Promise<
  | { status: "success" }
  | { status: "failed"; message: string }
> {
  const rollbackData: TaskListDto = {
    version: "1.0.0",
    tasks: destOriginalTasks,
  };
  const rollback = await writeTaskList(destFilePath, rollbackData, movedDestHash);

  if (rollback.status === "success") {
    return { status: "success" };
  }

  if (rollback.status === "conflict") {
    return {
      status: "failed",
      message:
        `The move failed while updating the ${cause}, and Dropkick could not restore the destination because it changed again. Reload both files before continuing.`,
    };
  }

  if (rollback.status === "deleted") {
    return {
      status: "failed",
      message:
        `The move failed while updating the ${cause}, and the destination file disappeared before it could be restored. Reload both files before continuing.`,
    };
  }

  return {
    status: "failed",
    message:
      `The move failed while updating the ${cause}, and Dropkick could not restore the destination automatically: ${rollback.message}`,
  };
}

export async function moveTasksBetweenFilesWithRollback(
  sourceFilePath: string,
  sourceTasks: TaskDto[],
  sourceExpectedHash: string,
  destFilePath: string,
  destTasks: TaskDto[],
  destExpectedHash: string,
  destOriginalTasks: TaskDto[],
): Promise<
  | { status: "success"; sourceHash: string; destHash: string }
  | { status: "source-conflict" }
  | { status: "dest-conflict" }
  | { status: "source-deleted" }
  | { status: "dest-deleted" }
  | { status: "rollback-failed"; message: string }
  | { status: "error"; message: string }
> {
  // Step 1: Write destination first (addition before deletion).
  const destData: TaskListDto = { version: "1.0.0", tasks: destTasks };
  const destResult = await writeTaskList(destFilePath, destData, destExpectedHash);

  if (destResult.status === "conflict") return { status: "dest-conflict" };
  if (destResult.status === "deleted") return { status: "dest-deleted" };
  if (destResult.status === "error") return { status: "error", message: destResult.message };

  // Step 2: Write source (removal).
  const sourceData: TaskListDto = { version: "1.0.0", tasks: sourceTasks };
  const sourceResult = await writeTaskList(sourceFilePath, sourceData, sourceExpectedHash);

  if (sourceResult.status === "conflict") {
    const rollback = await rollbackDestinationWrite(
      destFilePath,
      destOriginalTasks,
      destResult.newHash,
      "source file",
    );
    return rollback.status === "success"
      ? { status: "source-conflict" }
      : { status: "rollback-failed", message: rollback.message };
  }

  if (sourceResult.status === "deleted") {
    const rollback = await rollbackDestinationWrite(
      destFilePath,
      destOriginalTasks,
      destResult.newHash,
      "source file",
    );
    return rollback.status === "success"
      ? { status: "source-deleted" }
      : { status: "rollback-failed", message: rollback.message };
  }

  if (sourceResult.status === "error") {
    const rollback = await rollbackDestinationWrite(
      destFilePath,
      destOriginalTasks,
      destResult.newHash,
      "source file",
    );
    return rollback.status === "success"
      ? {
          status: "error",
          message:
            `The move failed while updating the source file. The destination was restored. ${sourceResult.message}`,
        }
      : { status: "rollback-failed", message: rollback.message };
  }

  return {
    status: "success",
    sourceHash: sourceResult.newHash,
    destHash: destResult.newHash,
  };
}
