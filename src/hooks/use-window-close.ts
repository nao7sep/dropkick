// Holds the window open until pending writes are on disk, within a bound.
//
// Tauri would otherwise terminate the renderer the moment the OS sends the
// close request. That defeats the "writes happen immediately" promise for
// anything still in flight, and for anything committed only on blur (title /
// description inputs, inline rename) where the user closes the window while
// still focused on the field.
//
// SCOPE, precisely. This covers the close request: the red button,
// `performClose:`, and the app's own Quit item (Cmd+Q and the app menu), which
// closes the window instead of terminating (src-tauri/src/menu.rs). It is NOT
// reached by Dock > Quit or force-quit: those route through `terminate:`, and
// nothing in tao, wry, tauri or tauri-runtime-wry implements
// `applicationShouldTerminate:`. Nothing here may therefore be the only thing
// standing between the user and lost work — typed text is written through as
// it is typed for exactly that reason (state/note-draft-store), and this
// handler only collapses the coalescing window on the exits it can see.
//
// The wait is bounded. A write stuck on an unresponsive volume would otherwise
// hold the window open with no feedback, so after CLOSE_WAIT_MS the user is
// told which files are still being written and may close anyway.

import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { drainAllSerial, log, pendingSerialKeys, toErrorFields } from "../repositories";
import { flushNoteDraftsNow } from "../state/note-draft-store";
import { showAppConfirm } from "../state/dialog-store";
import { message } from "../i18n/translate";

export const CLOSE_WAIT_MS = 3000;

// The work that must finish before the window is destroyed.
async function settlePendingWrites(): Promise<void> {
  // Blur first, so a field that commits on blur fires its write synchronously
  // and lands in the serial chain we are about to drain.
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  await drainAllSerial();
  // Then collapse the draft store's coalescing window, after the drain so it
  // records what the drained commits cleared. Drafts are already on disk within
  // WRITE_IDLE_MS of the last keystroke; this makes the graceful close lose
  // nothing at all.
  await flushNoteDraftsNow();
}

function within(work: Promise<void>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    void work.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

// Settles pending writes before a close. Resolves true when the window may be
// destroyed: the writes finished, or the user chose to close anyway. Resolves
// false when the user chose to keep the window open. Exported so the close
// path can be exercised without driving a real window.
export async function prepareWindowClose(waitMs = CLOSE_WAIT_MS): Promise<boolean> {
  const settled = settlePendingWrites();
  if (await within(settled, waitMs)) return true;

  const paths = pendingSerialKeys();
  log.warn("window close waiting on writes", { paths, waitMs });
  // The question stops mattering once the writes finish, so it is withdrawn
  // then and the close goes ahead as if it had never been asked.
  const withdraw = new AbortController();
  const answer = showAppConfirm(
    message("dialog.stillSaving.title"),
    message("dialog.stillSaving.body", { paths: paths.join("\n") }),
    {
      tone: "warning",
      confirmLabel: message("dialog.stillSaving.closeAnyway"),
      cancelLabel: message("dialog.stillSaving.keepOpen"),
      signal: withdraw.signal,
    },
  );
  const outcome = await Promise.race([
    settled.then(() => "settled" as const),
    answer.then((closeAnyway) => (closeAnyway ? ("close-anyway" as const) : ("keep-open" as const))),
  ]);
  withdraw.abort();
  if (outcome === "close-anyway") {
    log.warn("window closed with writes pending", { paths: pendingSerialKeys() });
  }
  return outcome !== "keep-open";
}

export function useWindowClose(): void {
  // The mounted flag protects against the StrictMode mount -> cleanup -> mount
  // sequence so the listener is never double-registered or leaked.
  useEffect(() => {
    let mounted = true;
    let unlistenFn: (() => void) | null = null;
    // One close at a time: a second click (or Cmd+Q) while the first is still
    // waiting joins it rather than starting another wait and another dialog.
    let closing = false;

    (async () => {
      const appWindow = getCurrentWindow();
      const unlisten = await appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing) return;
        closing = true;
        log.info("window close requested", {});
        try {
          if (await prepareWindowClose()) {
            await appWindow.destroy();
          }
        } catch (e) {
          // A rejection from destroy() leaves the window open. Better that
          // than an unhandled rejection with preventDefault already called —
          // the user can retry the close.
          log.error("window close failed", toErrorFields(e));
        } finally {
          closing = false;
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
