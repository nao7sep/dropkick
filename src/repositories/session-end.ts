// The end of an OS session (logout, restart, shutdown): the Rust core asks the
// main window to settle its writes without asking anything, and is told when
// it has (src-tauri/src/os_quit.rs).

import { invoke } from "@tauri-apps/api/core";
import { subscribe } from "./events";

// os_quit::SESSION_ENDING_EVENT.
const SESSION_ENDING = "session-ending";

export function onSessionEnding(listener: () => void): () => void {
  return subscribe<null>(SESSION_ENDING, () => listener());
}

export async function reportSessionEndSettled(): Promise<void> {
  await invoke("session_end_settled");
}
