// Low-level file system operations via Tauri plugins.
// All file I/O goes through this module — no other code touches Tauri fs directly.

import { readTextFile, writeTextFile, exists, mkdir } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { log, toErrorFields } from "./logging";

export type JsonReadResult<T> =
  | { status: "success"; data: T }
  | { status: "missing" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

export type JsonReadWithHashResult<T> =
  | { status: "success"; data: T; hash: string }
  | { status: "missing" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

// Reads a JSON file from disk and parses it.
// Returns null if the file does not exist.
export async function readJsonFile<T>(path: string): Promise<T | null> {
  const result = await readJsonFileResult<T>(path);
  if (result.status === "missing") return null;
  if (result.status === "success") return result.data;
  throw new Error(result.message);
}

// Reads a JSON file from disk and returns an explicit load result.
export async function readJsonFileResult<T>(
  path: string,
): Promise<JsonReadResult<T>> {
  try {
    const fileExists = await exists(path);
    if (!fileExists) return { status: "missing" };

    const text = await readTextFile(path);
    try {
      return { status: "success", data: JSON.parse(text) as T };
    } catch (e) {
      return {
        status: "invalid",
        message: e instanceof Error ? e.message : String(e),
      };
    }
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

// Reads a JSON file once via the backend and returns the parsed data plus a
// hash of the exact bytes that were read.
export async function readJsonFileWithHash<T>(
  path: string,
): Promise<JsonReadWithHashResult<T>> {
  return await invoke<JsonReadWithHashResult<T>>("read_json_file_with_hash", {
    path,
  });
}

// Writes an object to disk as formatted JSON. This is the single write boundary
// for every JSON file (preferences, workspace, app config, task lists), so it
// logs the write (debug) and surfaces any failure (error) with its path before
// re-propagating it.
export async function writeJsonFile<T>(path: string, data: T): Promise<void> {
  const text = JSON.stringify(data, null, 2);
  try {
    await writeTextFile(path, text);
    log.debug("file write", { path, chars: text.length });
  } catch (e) {
    log.error("file write failed", { path, ...toErrorFields(e) });
    throw e;
  }
}

// Computes SHA-256 hash of a file via the Rust backend.
// Returns null if the file does not exist.
export async function hashFile(path: string): Promise<string | null> {
  const fileExists = await exists(path);
  if (!fileExists) return null;

  return await invoke<string>("hash_file", { path });
}

// Checks if a file exists on disk.
export async function fileExists(path: string): Promise<boolean> {
  return await exists(path);
}

// Ensures a directory exists, creating it recursively if needed.
export async function ensureDirectory(path: string): Promise<void> {
  const dirExists = await exists(path);
  if (!dirExists) {
    await mkdir(path, { recursive: true });
  }
}

// --- Per-key serialization ---
//
// Some files (task list JSON, workspace JSON) can be mutated by many actions in
// quick succession. Each mutation reads → checks hash → writes, but the JS
// event loop allows another action to interleave at any await point. That
// produces two failure modes: spurious "file modified externally" prompts when
// two actions race their hash checks, and silent overwrites when two writes
// land out of order.
//
// `withSerial` enforces that only one async callback per key is running at a
// time; subsequent callers wait for the previous one to settle. Rejections do
// not break the chain — the next caller runs either way.

const serialChains = new Map<string, Promise<unknown>>();

export async function withSerial<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = serialChains.get(key) ?? Promise.resolve();
  const settled = prev.then(
    () => undefined,
    () => undefined,
  );
  const current = settled.then(fn);
  const tail = current.then(
    () => undefined,
    () => undefined,
  );
  serialChains.set(key, tail);
  // Drop the entry once this tail settles, unless a newer tail replaced it.
  void tail.then(() => {
    if (serialChains.get(key) === tail) {
      serialChains.delete(key);
    }
  });
  return current;
}

// Acquires two keys in lexicographic order to avoid deadlocks when two callers
// request the same pair in opposite orders.
export async function withSerialTwo<T>(
  keyA: string,
  keyB: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (keyA === keyB) return withSerial(keyA, fn);
  const [first, second] = keyA < keyB ? [keyA, keyB] : [keyB, keyA];
  return withSerial(first, () => withSerial(second, fn));
}

// Awaits every per-key serial chain currently in flight. Used at window-close
// time to make sure pending writes (including ones triggered by the blur of a
// focused input during shutdown) land on disk before the renderer terminates.
//
// Loops because a chain that settles during the await may have had a new
// callback enqueued behind it — typically the blur-fired commit we're trying
// to catch. When no callbacks are outstanding the cleanup in withSerial has
// removed the key, so the map's size collapses to zero and the loop exits.
export async function drainAllSerial(): Promise<void> {
  while (serialChains.size > 0) {
    const tails = [...serialChains.values()];
    await Promise.allSettled(tails);
  }
}
