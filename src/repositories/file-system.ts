// Low-level file system operations via Tauri plugins.
// All file I/O goes through this module — no other code touches Tauri fs directly.

import { readTextFile, writeTextFile, exists, mkdir } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

// Reads a JSON file from disk and parses it.
// Returns null if the file does not exist.
export async function readJsonFile<T>(path: string): Promise<T | null> {
  const fileExists = await exists(path);
  if (!fileExists) return null;

  const text = await readTextFile(path);
  return JSON.parse(text) as T;
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
