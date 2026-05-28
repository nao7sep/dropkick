// Reads and writes task list JSON files.
//
// This repository owns the SHA-256 hash captured at load (or last successful
// write) for every loaded file and serializes writes per path. Two store
// actions targeting the same file can no longer race against each other on
// disk — the hash check only fires for genuine external modifications. Where
// the disk state has drifted (modified or removed by another process), the
// repository prompts the user via the dialog helpers and returns the
// post-dialog outcome to the store.

import type { TaskListDto, TaskDto } from "../models";
import { createEmptyTaskList } from "../models";
import {
  readJsonFileWithHash,
  writeJsonFile,
  hashFile,
  fileExists,
  withSerial,
  withSerialTwo,
} from "./file-system";
import {
  showFileConflictDialog,
  showFileDeletedDialog,
} from "./dialogs";

// Represents a loaded task list.
export interface LoadedTaskList {
  filePath: string;
  data: TaskListDto;
}

export type LoadTaskListResult =
  | { status: "success"; taskList: LoadedTaskList }
  | { status: "missing" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

// Result of a flush as the store sees it. The repository has already handled
// any conflict/deleted dialog by the time this resolves.
export type WriteResult =
  | { status: "success" }
  | { status: "reloaded"; data: TaskListDto; message: string }
  | { status: "error"; message: string };

// Result of a two-file move. The store applies `sourceData`/`destData` on
// success and leaves its in-memory state untouched on any other outcome.
export type MoveResult =
  | { status: "success"; sourceData: TaskListDto; destData: TaskListDto }
  | { status: "source-conflict" }
  | { status: "dest-conflict" }
  | { status: "source-deleted" }
  | { status: "dest-deleted" }
  | { status: "rollback-failed"; message: string }
  | { status: "error"; message: string };

// Inputs the store provides to `flushMove`. Returned by a closure invoked
// inside the serial slot so the data reflects the latest store state.
export interface MoveInputs {
  sourceDataPreMove: TaskListDto;
  destDataPreMove: TaskListDto;
  sourceTasksPostMove: TaskDto[];
  destTasksPostMove: TaskDto[];
}

// Authoritative within this process because every write goes through here.
const knownHashes = new Map<string, string>();

function rememberHash(filePath: string, hash: string): void {
  knownHashes.set(filePath, hash);
}

// Called by the store when a tab closes so the repository can release state.
// Routed through the same serial chain as flushes so any queued write for this
// path lands on disk before the hash is dropped.
export async function forgetTaskList(filePath: string): Promise<void> {
  await withSerial(filePath, async () => {
    knownHashes.delete(filePath);
  });
}

// Loads a task list and records its hash for future writes.
// Serialized per path so a load racing against an in-flight forget for the
// same path lands in a deterministic order — the load either runs first (and
// is then unregistered) or last (and stays registered).
export async function loadTaskList(
  filePath: string,
): Promise<LoadTaskListResult> {
  return withSerial(filePath, async () => {
    const loaded = await readJsonFileWithHash<TaskListDto>(filePath);
    if (loaded.status !== "success") return loaded;
    rememberHash(filePath, loaded.hash);
    return {
      status: "success",
      taskList: { filePath, data: loaded.data },
    };
  });
}

// Creates an empty task list file on disk and records its hash.
// Serialized per path for the same reason as loadTaskList.
export async function createTaskListFile(
  filePath: string,
): Promise<LoadedTaskList> {
  return withSerial(filePath, async () => {
    const data = createEmptyTaskList();
    await writeJsonFile(filePath, data);
    const hash = await hashFile(filePath);
    if (hash === null) {
      throw new Error(`Failed to hash newly created file: ${filePath}`);
    }
    rememberHash(filePath, hash);
    return { filePath, data };
  });
}

// --- Internal helpers (always called inside a serial slot) ---

async function writeAndRemember(
  filePath: string,
  data: TaskListDto,
): Promise<void> {
  await writeJsonFile(filePath, data);
  const newHash = await hashFile(filePath);
  if (newHash === null) {
    throw new Error(`Failed to hash file after write: ${filePath}`);
  }
  rememberHash(filePath, newHash);
}

type HashCheckedWrite =
  | { status: "success" }
  | { status: "conflict" }
  | { status: "deleted" };

async function writeIfHashMatches(
  filePath: string,
  data: TaskListDto,
): Promise<HashCheckedWrite> {
  const expected = knownHashes.get(filePath);
  if (expected === undefined) {
    // Repository contract: callers register the file by loading it first.
    throw new Error(`File not registered: ${filePath}`);
  }
  if (!(await fileExists(filePath))) return { status: "deleted" };
  const current = await hashFile(filePath);
  if (current === null) return { status: "deleted" };
  if (current !== expected) return { status: "conflict" };
  await writeAndRemember(filePath, data);
  return { status: "success" };
}

async function resolveConflict(
  filePath: string,
  data: TaskListDto,
): Promise<WriteResult> {
  const choice = await showFileConflictDialog(filePath);
  if (choice === "overwrite") {
    await writeAndRemember(filePath, data);
    return { status: "success" };
  }
  // Reload: drop local change and pick up disk state.
  const loaded = await readJsonFileWithHash<TaskListDto>(filePath);
  if (loaded.status === "missing") {
    knownHashes.delete(filePath);
    return {
      status: "error",
      message: "The file no longer exists. Your in-app change was not saved.",
    };
  }
  if (loaded.status !== "success") {
    return {
      status: "error",
      message: `The file changed outside Dropkick but could not be reloaded: ${loaded.message}`,
    };
  }
  rememberHash(filePath, loaded.hash);
  return {
    status: "reloaded",
    data: loaded.data,
    message:
      "The file was reloaded from disk. Your in-app change was not saved.",
  };
}

async function resolveDeleted(
  filePath: string,
  data: TaskListDto,
): Promise<WriteResult> {
  const choice = await showFileDeletedDialog(filePath);
  if (choice === "save") {
    await writeAndRemember(filePath, data);
    return { status: "success" };
  }
  return {
    status: "error",
    message: "The file was not recreated. Your in-app change was not saved.",
  };
}

// --- Public flush surface ---

// Flushes the latest store state for one file. Runs serialized per path: only
// one flush is in flight for a given path at a time. `getData` is invoked
// inside the slot, so it sees the latest store state at the instant of the
// write. Conflict and deleted-file dialogs are handled inline.
export async function flushTaskList(
  filePath: string,
  getData: () => TaskListDto,
): Promise<WriteResult> {
  return withSerial(filePath, async () => {
    if (knownHashes.get(filePath) === undefined) {
      return { status: "error", message: "File not loaded" };
    }

    const data = getData();
    const attempt = await writeIfHashMatches(filePath, data);
    if (attempt.status === "success") return { status: "success" };
    if (attempt.status === "deleted") return resolveDeleted(filePath, data);
    return resolveConflict(filePath, data);
  });
}

// Force-writes a file without a hash check. Used by the store's recovery
// actions (e.g. Retry from a load-error pane). Still serialized per path so it
// cannot interleave with concurrent flushes.
export async function forceFlushTaskList(
  filePath: string,
  data: TaskListDto,
): Promise<void> {
  await withSerial(filePath, () => writeAndRemember(filePath, data));
}

// Atomically moves a set of tasks between two files. Holds the serial slot for
// both files for the entire operation. `compute` is called inside the slots so
// it sees the latest store state; returning `null` aborts the move without
// touching disk.
export async function flushMove(
  sourceFilePath: string,
  destFilePath: string,
  compute: () => MoveInputs | null,
): Promise<MoveResult> {
  return withSerialTwo(sourceFilePath, destFilePath, async () => {
    if (knownHashes.get(sourceFilePath) === undefined) {
      return { status: "error", message: "Source file not loaded" };
    }
    if (knownHashes.get(destFilePath) === undefined) {
      return { status: "error", message: "Destination file not loaded" };
    }

    const inputs = compute();
    if (inputs === null) {
      return { status: "error", message: "Nothing to move" };
    }

    const destDataPostMove: TaskListDto = {
      ...inputs.destDataPreMove,
      tasks: inputs.destTasksPostMove,
    };
    const sourceDataPostMove: TaskListDto = {
      ...inputs.sourceDataPreMove,
      tasks: inputs.sourceTasksPostMove,
    };

    // Step 1: write destination (addition before deletion).
    const destResult = await writeIfHashMatches(destFilePath, destDataPostMove);
    if (destResult.status === "conflict") return { status: "dest-conflict" };
    if (destResult.status === "deleted") return { status: "dest-deleted" };

    // Step 2: write source.
    const sourceResult = await writeIfHashMatches(
      sourceFilePath,
      sourceDataPostMove,
    );
    if (sourceResult.status === "success") {
      return {
        status: "success",
        sourceData: sourceDataPostMove,
        destData: destDataPostMove,
      };
    }

    // Source-write failed; roll the destination back.
    const rollback = await writeIfHashMatches(
      destFilePath,
      inputs.destDataPreMove,
    );
    if (rollback.status !== "success") {
      return {
        status: "rollback-failed",
        message:
          "The move failed and Dropkick could not restore the destination. Reload both files before continuing.",
      };
    }
    return sourceResult.status === "conflict"
      ? { status: "source-conflict" }
      : { status: "source-deleted" };
  });
}
