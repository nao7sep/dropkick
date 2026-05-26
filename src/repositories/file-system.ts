// Low-level file system operations via Tauri plugins.
// All file I/O goes through this module — no other code touches Tauri fs directly.

import { readTextFile, writeTextFile, exists, mkdir } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

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

// Writes an object to disk as formatted JSON.
export async function writeJsonFile<T>(path: string, data: T): Promise<void> {
  const text = JSON.stringify(data, null, 2);
  await writeTextFile(path, text);
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
