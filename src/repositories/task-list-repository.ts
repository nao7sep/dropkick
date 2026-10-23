// Reads and writes task list JSON files.
//
// This repository owns the SHA-256 hash captured at load (or last successful
// write) for every loaded file and serializes writes per path. Two store
// actions targeting the same file can no longer race against each other on
// disk — the hash check only fires for genuine external modifications. Lists
// are user files that git, editors and synced folders may change while open,
// so a save never silently overwrites such a change: where the disk state has
// drifted (modified or removed by another process), the repository prompts the
// user via the dialog helpers and returns the post-dialog outcome to the store.
// Outside a save, the store picks up a change with refreshTaskList when the
// user returns to a list; nothing watches the files.

import type { TaskListDto, TaskDto } from "../models";
import { createEmptyTaskList } from "../models";
import {
  readJsonFileWithHash,
  saveTaskFile,
  withSerial,
  createLatestSerial,
  withSerialTwo,
} from "./file-system";
import type { JsonReadWithHashResult } from "./file-system";
import {
  showFileConflictDialog,
  showFileDeletedDialog,
  showMessage,
  chooseSeparateTaskCopy,
} from "./dialogs";
import { log, toErrorFields } from "./logging";
import { message, type Message } from "../i18n/translate";

// Represents a loaded task list.
export interface LoadedTaskList {
  filePath: string;
  data: TaskListDto;
}

export type LoadTaskListResult =
  | { status: "success"; taskList: LoadedTaskList }
  | { status: "missing" }
  | { status: "invalid"; message: string }
  | { status: "newer"; formatVersion: number }
  | { status: "error"; message: string };

// Result of checking a loaded file against the disk after a change there.
// `kept` means the disk differs but the caller declined the new copy, so the
// stored hash still names the copy it holds and its next save meets the
// conflict dialog. The failures leave the loaded copy and its hash as they were.
export type RefreshResult =
  | { status: "unchanged" }
  | { status: "reloaded" }
  | { status: "kept" }
  | { status: "notLoaded" }
  | { status: "missing" }
  | { status: "invalid"; message: string }
  | { status: "newer"; formatVersion: number }
  | { status: "error"; message: string };

// Result of a flush as the store sees it. The repository has already handled
// any conflict/deleted dialog by the time this resolves. A covered request
// must not replay the earlier caller’s state transition.
export type WriteResult =
  | { status: "covered" }
  | { status: "success" }
  | { status: "reloaded"; data: TaskListDto; message: Message }
  | { status: "error"; message: Message };

// Result of a two-file move. The store applies `sourceData`/`destData` on
// success and leaves its in-memory state untouched on any other outcome.
export type MoveResult =
  | { status: "success"; sourceData: TaskListDto; destData: TaskListDto }
  | { status: "source-conflict" }
  | { status: "dest-conflict" }
  | { status: "source-deleted" }
  | { status: "dest-deleted" }
  | { status: "dest-unsaved" }
  | { status: "source-uncertain"; message: Message }
  | { status: "error"; message: Message };

// Inputs the store provides to `flushMove`. Returned by a closure invoked
// inside the serial slot so the data reflects the latest store state.
export interface MoveInputs {
  sourceDataPreMove: TaskListDto;
  destDataPreMove: TaskListDto;
  sourceTasksPostMove: TaskDto[];
  destTasksPostMove: TaskDto[];
  onSaved?: (sourceData: TaskListDto, destData: TaskListDto) => void;
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
  }, "optional");
}

// Loads a task list and records its hash for future writes.
// Serialized per path so a load racing against an in-flight forget for the
// same path lands in a deterministic order — the load either runs first (and
// is then unregistered) or last (and stays registered).
export async function loadTaskList(
  filePath: string,
  onLoaded?: (data: TaskListDto) => void,
): Promise<LoadTaskListResult> {
  return withSerial(filePath, async () => {
    const loaded = await readJsonFileWithHash<TaskListDto>(filePath);
    if (loaded.status !== "success") return loaded;
    rememberHash(filePath, loaded.hash);
    onLoaded?.(loaded.data);
    return {
      status: "success",
      taskList: { filePath, data: loaded.data },
    };
  }, "optional");
}

// Creates an empty task list file on disk and records its hash.
// Serialized per path for the same reason as loadTaskList.
export async function createTaskListFile(
  filePath: string,
): Promise<LoadedTaskList> {
  return withSerial(filePath, async () => {
    const data = createEmptyTaskList();
    const result = await writeAndRemember(filePath, data);
    if (result.status !== "success") throw new Error("Choose a new file name; the existing file was not replaced.");
    return { filePath, data };
  });
}

// Checks a loaded file against the disk when the user returns to it.
// Serialized per path, so it runs after any write already queued: the app's own
// save then reads back as `unchanged`, because the stored hash is the one that
// save produced. A changed copy is offered to `adopt` inside the same slot, so
// no flush can run between the caller's decision and the hash it implies.
export async function refreshTaskList(
  filePath: string,
  adopt: (data: TaskListDto) => boolean,
): Promise<RefreshResult> {
  return withSerial(filePath, async () => {
    const known = knownHashes.get(filePath);
    if (known === undefined) return { status: "notLoaded" };
    let loaded: JsonReadWithHashResult<TaskListDto> | { status: "unchanged" };
    try {
      loaded = await readJsonFileWithHash<TaskListDto>(filePath, known);
    } catch (e) {
      return { status: "error", message: e instanceof Error ? e.message : String(e) };
    }
    if (loaded.status !== "success") return loaded;
    if (!adopt(loaded.data)) return { status: "kept" };
    rememberHash(filePath, loaded.hash);
    return { status: "reloaded" };
  }, "optional");
}

// --- Internal helpers (always called inside a serial slot) ---

class SaveFailure extends Error {
  constructor(message: string, readonly publication: "untouched" | "unknown") { super(message); }
}

type HashCheckedWrite =
  | { status: "success" }
  | { status: "conflict" }
  | { status: "deleted" }
  | { status: "unsupported" };

async function writeAndRemember(filePath: string, data: TaskListDto,
  admission: import("./file-system").TaskSaveAdmission = { kind: "overwrite" }): Promise<HashCheckedWrite> {
  const result = await saveTaskFile(filePath, data, admission);
  if (result.status === "failed") throw new SaveFailure(result.message, result.publication);
  if (result.status === "missing") return { status: "deleted" };
  if (result.status !== "saved") return { status: result.status };
  rememberHash(filePath, result.hash);
  if (result.recoveryPath) {
    // Publication is already known. A notice cannot turn it into a failed save
    // or delay a move's next required write.
    void showMessage(message("save.collisionTitle"), message("save.collisionBody", { path: filePath, recovery: result.recoveryPath }))
      .catch(error => log.warn("save collision notice failed", toErrorFields(error)));
  }
  return { status: "success" };
}

async function writeIfHashMatches(filePath: string, data: TaskListDto): Promise<HashCheckedWrite> {
  const hash = knownHashes.get(filePath);
  if (hash === undefined) throw new Error(`File not registered: ${filePath}`);
  return writeAndRemember(filePath, data, { kind: "compare", hash });
}

async function separateCopy(filePath: string, data: TaskListDto): Promise<WriteResult> {
  const path = await chooseSeparateTaskCopy(filePath);
  if (path === null) return { status: "error", message: message("save.separateRequired") };
  const result = await saveTaskFile(path, data, { kind: "create" });
  if (result.status === "failed") throw new SaveFailure(result.message, result.publication);
  // Creating a separate copy never changes the original's comparison authority
  // or marks the original saved. An occupied name is refused, even if a native
  // picker offered overwrite, so this escape cannot reintroduce replacement.
  return { status: "error", message: result.status === "saved"
    ? message("save.copySaved", { path }) : message("save.copyNeedsNewName") };
}

async function finishExplicitSave(filePath: string, data: TaskListDto, create: boolean): Promise<WriteResult> {
  const result = await writeAndRemember(filePath, data, { kind: create ? "create" : "overwrite" });
  if (result.status === "success") return result;
  if (result.status === "unsupported") return separateCopy(filePath, data);
  return { status: "error", message: message("save.changedAgain") };
}

async function resolveConflict(
  filePath: string,
  data: TaskListDto,
  adopt?: (data: TaskListDto) => boolean,
): Promise<WriteResult> {
  // A newer build's file is intact data this build cannot read, so it is never
  // offered for overwriting (store-recovery-conventions). The stored hash stays,
  // so the next save finds the same file and says the same.
  const disk = await readJsonFileWithHash<TaskListDto>(filePath);
  if (disk.status === "newer") {
    return { status: "error", message: message("write.newerOnDisk") };
  }
  const choice = await showFileConflictDialog(filePath);
  if (choice === "withdrawn") {
    return { status: "error", message: message("write.taskList") };
  }
  if (choice === "overwrite") {
    return finishExplicitSave(filePath, data, false);
  }
  // A failed reload leaves the local edit and its last confirmed hash owned
  // by this open list. Retry must recheck disk and offer recovery again.
  const loaded = await readJsonFileWithHash<TaskListDto>(filePath);
  if (loaded.status === "missing") {
    return {
      status: "error",
      message: message("write.fileGone"),
    };
  }
  if (loaded.status !== "success") {
    return {
      status: "error",
      message: message("write.reloadFailed"),
    };
  }
  // The data and its comparison authority must be accepted together inside
  // the serial slot. A refused identity keeps the previous hash for Retry.
  if (adopt && !adopt(loaded.data)) return { status: "reloaded", data: loaded.data, message: message("write.reloaded") };
  rememberHash(filePath, loaded.hash);
  return {
    status: "reloaded",
    data: loaded.data,
    message:
      message("write.reloaded"),
  };
}

async function resolveDeleted(
  filePath: string,
  data: TaskListDto,
): Promise<WriteResult> {
  const choice = await showFileDeletedDialog(filePath);
  if (choice === "save") {
    return finishExplicitSave(filePath, data, true);
  }
  // Cancelling recreation keeps the local edit retryable. Only unloading
  // the list releases its hash; a later retry may recreate or find a conflict.
  return {
    status: "error",
    message: message("write.notRecreated"),
  };
}

// --- Public flush surface ---

// Flushes the latest store state for one file. Runs serialized per path: only
// one flush is in flight for a given path at a time. `getData` is invoked
// inside the slot, so it sees the latest store state at the instant of the
// write. Conflict and deleted-file dialogs are handled inline.
const latestSave = createLatestSerial();

export async function flushTaskList(
  filePath: string,
  getData: () => TaskListDto,
  onReloaded?: (data: TaskListDto) => boolean,
): Promise<WriteResult> {
  const result = await latestSave<WriteResult>(filePath, async () => {
    if (knownHashes.get(filePath) === undefined) {
      return { status: "error", message: message("write.notLoaded") };
    }

    const data = getData();
    const attempt = await writeIfHashMatches(filePath, data);
    if (attempt.status === "success") return { status: "success" };
    if (attempt.status === "unsupported") return separateCopy(filePath, data);
    // The on-disk file drifted from what we last wrote — recoverable but
    // unexpected, so it is a warning. The user resolves it via the dialog.
    log.warn("task list modified externally", {
      path: filePath,
      kind: attempt.status,
    });
    if (attempt.status === "deleted") return resolveDeleted(filePath, data);
    return resolveConflict(filePath, data, onReloaded);
  });
  return result.covered ? { status: "covered" } : result.value;
}

// Publishes a move destination first, then source. Holds the serial slot for
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
      return { status: "error", message: message("move.sourceNotLoaded") };
    }
    if (knownHashes.get(destFilePath) === undefined) {
      return { status: "error", message: message("move.destNotLoaded") };
    }

    const inputs = compute();
    if (inputs === null) {
      return { status: "error", message: message("move.nothing") };
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
    const previousDestHash = knownHashes.get(destFilePath)!;
    const destResult = await writeIfHashMatches(destFilePath, destDataPostMove);
    if (destResult.status === "conflict") return { status: "dest-conflict" };
    if (destResult.status === "deleted") return { status: "dest-deleted" };
    if (destResult.status === "unsupported") return { status: "error", message: message("save.separateRequired") };

    // Destination is published first. Only a native untouched result permits
    // compensation; transport failures and partial replacement remain unknown.
    let sourceResult: HashCheckedWrite | { status: "failed" };
    try {
      sourceResult = await writeIfHashMatches(sourceFilePath, sourceDataPostMove);
    } catch (e) {
      if (!(e instanceof SaveFailure) || e.publication !== "untouched") {
        // Keep the destination copy. Its previous comparison hash ensures a
        // later edit cannot silently erase this unresolved copy. The source
        // stays on screen and is marked unsaved by the store.
        rememberHash(destFilePath, previousDestHash);
        return { status: "source-uncertain", message: message("save.moveUncertain") };
      }
      log.warn("move source write failed; rolling back destination", {
        source: sourceFilePath,
        dest: destFilePath,
        ...toErrorFields(e),
      });
      sourceResult = { status: "failed" };
    }
    if (sourceResult.status === "success") {
      inputs.onSaved?.(sourceDataPostMove, destDataPostMove);
      return {
        status: "success",
        sourceData: sourceDataPostMove,
        destData: destDataPostMove,
      };
    }

    // Source-write failed; roll the destination back. A throw here is a failed
    // rollback like any other. A destination left holding the moved tasks is
    // reported as unsaved rather than told to reload: its stored hash is the
    // moved copy's, so returning to it reads it as unchanged, and the store's
    // in-memory copy (pre-move) is what a Retry or the next save writes back.
    let rolledBack = false;
    try {
      rolledBack =
        (await writeIfHashMatches(destFilePath, inputs.destDataPreMove)).status === "success";
    } catch (e) {
      log.error("move rollback write failed", { dest: destFilePath, ...toErrorFields(e) });
    }
    if (!rolledBack) return { status: "dest-unsaved" };
    switch (sourceResult.status) {
      case "conflict":
        return { status: "source-conflict" };
      case "deleted":
        return { status: "source-deleted" };
      case "unsupported":
        return { status: "error", message: message("save.separateRequired") };
      case "failed":
        return { status: "error", message: message("move.failed") };
    }
  });
}
