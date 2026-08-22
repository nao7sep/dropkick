// Low-level file system operations, all via the Rust core (Tauri commands).
// The webview carries no fs plugin, so no file API is exposed to page script
// directly and all file I/O goes through this module.
//
// That is not a sandbox: these commands pass an absolute path to the core,
// which does not scope or canonicalize it, so code running in the renderer can
// reach any file the user can. See the note above read_text_file in
// src-tauri/src/lib.rs for the exposure this does and does not cover.

import { invoke } from "@tauri-apps/api/core";
import { log, toErrorFields } from "./logging";

// Mirror of the Rust TextReadResult union (read_text_file command).
type TextReadResult =
  | { status: "success"; text: string }
  | { status: "missing" }
  | { status: "error"; message: string };

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

// Reads a JSON file from disk and returns an explicit load result.
export async function readJsonFileResult<T>(
  path: string,
): Promise<JsonReadResult<T>> {
  let result: TextReadResult;
  try {
    result = await invoke<TextReadResult>("read_text_file", { path });
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
  if (result.status === "missing") return { status: "missing" };
  if (result.status === "error") return { status: "error", message: result.message };
  try {
    return { status: "success", data: JSON.parse(result.text) as T };
  } catch (e) {
    return {
      status: "invalid",
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
// re-propagating it. This is also the write path for external documents saved
// at user-picked locations (preferences/task lists outside ~/.dropkick) — the
// Rust side stages its temp file beside `path` wherever that is, never under
// ~/.dropkick.
// Returns the SHA-256 the core computed from the bytes it wrote, so a caller
// that tracks the file's hash does not have to read it back.
export async function writeJsonFile<T>(
  path: string,
  data: T,
): Promise<string> {
  const text = JSON.stringify(data, null, 2);
  try {
    // Atomic on the Rust side (temp + fsync + rename), so a crash mid-write
    // never leaves a half-written file. The staging file
    // (`<stem>-<nanoid>.tmp`, beside `path`) is named from a nanoid the Rust
    // core generates itself.
    const hash = await invoke<string>("write_text_file_atomic", {
      path,
      contents: text,
    });
    log.debug("file write", { path, chars: text.length });
    return hash;
  } catch (e) {
    log.error("file write failed", { path, ...toErrorFields(e) });
    throw e;
  }
}

// Quarantines a present-but-unparseable managed store: the Rust core renames it
// beside itself to `<stem>-<millisecond-utc-stamp>.invalid` and returns the new
// path. Failure propagates to the caller — a failed quarantine must halt the
// load, never fall through to defaults over the preserved bytes (storage-path
// conventions).
export async function quarantineFile(path: string): Promise<string> {
  return await invoke<string>("quarantine_file", { path });
}

// Computes SHA-256 hash of a file via the Rust backend.
// Returns null if the file does not exist.
export async function hashFile(path: string): Promise<string | null> {
  return await invoke<string | null>("hash_file", { path });
}

// Checks if a file exists on disk.
export async function fileExists(path: string): Promise<boolean> {
  return await invoke<boolean>("file_exists", { path });
}

// Ensures a directory exists, creating it recursively if needed (idempotent).
export async function ensureDirectory(path: string): Promise<void> {
  await invoke("ensure_dir", { path });
}

// Every path the app reads or writes under its storage root.
//
// The Rust core resolves the whole layout — the root AND the name of every
// standard subpath — so the webview never composes a data path of its own. It
// used to receive only the root and join names onto it with a separator
// inferred from the string, which put path composition in the sandboxed process
// the storage-path conventions deliberately keep it out of, and left the layout
// itself described in no single place.
export interface AppPaths {
  root: string;
  stateFile: string;
  preferencesFile: string;
  workspaceFile: string;
  noteDraftsFile: string;
  logsDir: string;
  backupsFile: string;
}

export async function appPaths(): Promise<AppPaths> {
  return await invoke<AppPaths>("app_paths");
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
