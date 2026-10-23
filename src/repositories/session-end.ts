// The end of an OS session (logout, restart, shutdown): the Rust core asks the
// main window to settle its writes without asking anything, and is told when
// it has (the session_end_settled command).

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

// Native admission of the final close fact and destruction share one command;
// the renderer cannot disappear between forwarding the fact and closing.
export async function closeWindow(forwardingComplete: boolean): Promise<void> {
  await invoke("close_window", { forwardingComplete });
}
