// The launch's refused files that the Rust core found (its refusals module):
// a window placement or a side store a newer build wrote, or a side store that
// could not be read. The answer waits until both side stores have opened.
import { invoke } from "@tauri-apps/api/core";

export interface CoreRefusal {
  file: string;
  reason: "newer" | "unreadable";
  store: "windowPlacement" | "records" | "backups";
}

export async function launchRefusals(): Promise<CoreRefusal[]> {
  return await invoke<CoreRefusal[]>("launch_refusals");
}

// After a launch stop nothing is saved, window placement included.
export async function stopLaunch(): Promise<void> {
  await invoke<void>("stop_launch");
}
