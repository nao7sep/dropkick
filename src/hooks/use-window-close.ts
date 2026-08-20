// Holds the window open until pending writes are on disk.
//
// Tauri would otherwise terminate the renderer the moment the OS sends the
// close request. That defeats the "writes happen immediately" promise for
// anything still in flight, and for anything committed only on blur (title /
// description inputs, inline rename) where the user closes the window while
// still focused on the field.
//
// SCOPE, precisely. This covers the close request only — the red button and
// `performClose:`, which is all tao emits `CloseRequested` from. It is NOT
// reached by macOS Cmd+Q, the app menu, or Dock > Quit: those route through
// `terminate:`, and nothing in tao, wry, tauri or tauri-runtime-wry implements
// `applicationShouldTerminate:`. Nothing here may therefore be the only thing
// standing between the user and lost work — note drafts are written through as
// they are typed for exactly that reason (state/note-draft-store), and this
// handler only collapses the coalescing window on the one exit it can see.

import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { drainAllSerial, log, toErrorFields } from "../repositories";
import { flushNoteDraftsNow } from "../state/note-draft-store";

// The work that must finish before the window is destroyed. Exported so the
// close path can be exercised without driving a real window.
export async function prepareWindowClose(): Promise<void> {
  // Blur first, so a field that commits on blur fires its write synchronously
  // and lands in the serial chain we are about to drain.
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  // Then collapse the draft store's coalescing window. Drafts are already on
  // disk within WRITE_IDLE_MS of the last keystroke; this makes the graceful
  // close lose nothing at all. There is no prompt here: nothing is held back to
  // ask about.
  await flushNoteDraftsNow();
  await drainAllSerial();
}

export function useWindowClose(): void {
  // The mounted flag protects against the StrictMode mount -> cleanup -> mount
  // sequence so the listener is never double-registered or leaked.
  useEffect(() => {
    let mounted = true;
    let unlistenFn: (() => void) | null = null;

    (async () => {
      const appWindow = getCurrentWindow();
      const unlisten = await appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        log.info("window close requested", {});
        try {
          await prepareWindowClose();
          await appWindow.destroy();
        } catch (e) {
          // A rejection from destroy() leaves the window open. Better that
          // than an unhandled rejection with preventDefault already called —
          // the user can retry the close.
          log.error("window close failed", toErrorFields(e));
        }
      });
      if (mounted) {
        unlistenFn = unlisten;
      } else {
        unlisten();
      }
    })();

    return () => {
      mounted = false;
      unlistenFn?.();
    };
  }, []);
}
