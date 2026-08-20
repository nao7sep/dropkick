// Low-level file system operations, all via the Rust core (Tauri commands).
// The webview has NO direct filesystem access — no fs plugin, no `$HOME/**`
// scope — so a compromised renderer cannot read or write arbitrary files; the
// Rust core reaches only the specific paths these commands are handed. All file
// I/O goes through this module.

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
export async function writeJsonFile<T>(path: string, data: T): Promise<void> {
  const text = JSON.stringify(data, null, 2);
  try {
    // Atomic on the Rust side (temp + fsync + rename), so a crash mid-write
    // never leaves a half-written file. The staging file
    // (`<stem>-<nanoid>.tmp`, beside `path`) is named from a nanoid the Rust
    // core generates itself.
    await invoke("write_text_file_atomic", { path, contents: text });
    log.debug("file write", { path, chars: text.length });
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
  if (!(await fileExists(path))) return null;
  return await invoke<string>("hash_file", { path });
}

// Checks if a file exists on disk.
export async function fileExists(path: string): Promise<boolean> {
  return await invoke<boolean>("file_exists", { path });
}

// Ensures a directory exists, creating it recursively if needed (idempotent).
export async function ensureDirectory(path: string): Promise<void> {
  await invoke("ensure_dir", { path });
}

// Returns the app's absolute storage root (`~/.dropkick`, or DROPKICK_HOME),
// resolved and created by the Rust core. The Rust core is the only path
// resolver: the webview never reconstructs the root from homeDir() (which
// cannot read DROPKICK_HOME) — it calls this once and joins subpaths onto the
// returned absolute root with joinPath below.
export async function appDataRoot(): Promise<string> {
  return await invoke<string>("app_data_root");
}

// Joins path segments onto an already-absolute base using that base's own
// separator. With the absolute root supplied by Rust, this replaces the old
// separator-by-string-inspection: we infer the platform separator from the
// base (a Windows path contains "\") and trim any stray separators between
// segments rather than guessing whether to insert one.
export function joinPath(base: string, ...segments: string[]): string {
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  const trimEnd = (s: string) => s.replace(/[/\\]+$/, "");
  const trimBoth = (s: string) => s.replace(/^[/\\]+|[/\\]+$/g, "");
  let result = trimEnd(base);
  for (const segment of segments) {
    const part = trimBoth(segment);
    if (part) result = `${result}${sep}${part}`;
  }
  return result;
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
