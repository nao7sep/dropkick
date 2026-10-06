// Holds the window open until pending writes are on disk, within a bound.
//
// Tauri would otherwise terminate the renderer the moment the OS sends the
// close request. That defeats the "writes happen immediately" promise for
// anything still in flight, and for anything committed only on blur (title /
// description inputs, inline rename) where the user closes the window while
// still focused on the field.
//
// Every quit comes here (unsaved-edits-conventions, Quitting): the red button,
// `performClose:`, Alt+F4, the app's own Quit item (Cmd+Q and the app menu,
// src-tauri/src/menu.rs), and Dock > Quit (src-tauri/src/os_quit.rs) arrive as
// the close request; the end of an OS session arrives as its own event and
// settles the same writes without asking anything. Force-quit, a crash and
// power loss reach nothing, which is why typed text is written through as it
// is typed (state/note-draft-store).
//
// The wait is bounded. A write stuck on an unresponsive volume would otherwise
// hold the window open with no feedback, so after CLOSE_WAIT_MS the user is
// told which files are still being written and may close anyway.

import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  drainAllSerial,
  log,
  onSessionEnding,
  pendingSerialKeys,
  reportSessionEndSettled,
  toErrorFields,
} from "../repositories";
import { flushNoteDraftsNow, useNoteDraftStore } from "../state/note-draft-store";
import { useTaskListStore } from "../state/task-list-store";
import { refuseDialogs, showAppConfirm } from "../state/dialog-store";
import { message } from "../i18n/translate";

export const CLOSE_WAIT_MS = 3000;

// True while the OS ends the session: nothing is asked, and whatever could
// not be saved within the bound is logged and left.
let sessionEnding = false;

// The work that must finish before the window is destroyed. Resolves to the
// files the user's work could not be saved to: the drafts file, and every task
// list whose write failed outright. Empty when everything is on disk.
async function settlePendingWrites(): Promise<string[]> {
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
  const draftsSaved = await flushNoteDraftsNow();
  const failed = useTaskListStore.getState().failedWritePaths();
  if (!draftsSaved) failed.push(useNoteDraftStore.getState().filePath);
  return failed;
}

function within(work: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    void work.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

// Settles pending writes before a close. Resolves true when the window may be
// destroyed: the writes finished, the user chose to close anyway, or the
// session is ending. Resolves false when the user chose to keep the window
// open. Exported so the close path can be exercised without driving a real
// window.
//
// The task lists and the drafts are the user's own work, so a write of either
// that fails holds the close and offers Retry or Quit Anyway
// (unsaved-edits-conventions, Quitting). Retry makes the failed task-list
// writes again and runs the whole bounded settle again. A write that failed
// before the close was reported where it happened and rolled back, so only
// the ones this close meets are asked about.
export async function prepareWindowClose(waitMs = CLOSE_WAIT_MS): Promise<boolean> {
  useTaskListStore.getState().forgetFailedWrites();
  for (;;) {
    const settled = settlePendingWrites();
    if (!(await within(settled, waitMs))) {
      const outcome = await askWhileStillSaving(settled, waitMs);
      if (outcome !== "settled") return outcome === "close-anyway";
    }
    const paths = await settled;
    if (paths.length === 0) return true;
    if (sessionEnding) {
      log.warn("session ended with changes not saved", { paths });
      return true;
    }

    log.warn("window close held by changes not saved", { paths });
    const quitAnyway = await showAppConfirm(
      message("dialog.notSaved.title"),
      message("dialog.notSaved.body", { paths: paths.join("\n") }),
      {
        tone: "warning",
        confirmLabel: message("dialog.notSaved.quitAnyway"),
        cancelLabel: message("dialog.notSaved.retry"),
      },
    );
    if (quitAnyway || sessionEnding) {
      log.warn("window closed with changes not saved", { paths });
      return true;
    }
    useTaskListStore.getState().retryFailedWrites();
  }
}

// Past the bound, names the files still being written and lets the user close
// anyway. The question stops mattering once the writes finish, so it is
// withdrawn then and the close goes ahead as if it had never been asked. At
// the end of a session the close goes ahead with the writes still pending.
async function askWhileStillSaving(
  settled: Promise<string[]>,
  waitMs: number,
): Promise<"settled" | "close-anyway" | "keep-open"> {
  const paths = pendingSerialKeys();
  log.warn("window close waiting on writes", { paths, waitMs });
  const withdraw = new AbortController();
  // At the end of a session the dialog store cancels the question at once.
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
    answer.then((closeAnyway) =>
      closeAnyway || sessionEnding ? ("close-anyway" as const) : ("keep-open" as const),
    ),
  ]);
  withdraw.abort();
  if (outcome === "close-anyway") {
    log.warn("window closed with writes pending", { paths: pendingSerialKeys() });
  }
  return outcome;
}

// The OS is ending the session: settle within the bound, ask nothing, and tell
// the core, which lets the session go on. A close the user started that is
// still running is joined rather than run twice; its question, if on screen,
// is cancelled. The window is left for the OS to end, and if the session goes
// on after all (Windows lets another app cancel it) the app carries on as
// before.
async function endSession(running: Promise<boolean> | null): Promise<void> {
  if (sessionEnding) return;
  sessionEnding = true;
  refuseDialogs(true);
  try {
    await (running ?? prepareWindowClose());
  } catch (e) {
    log.error("session end settle failed", toErrorFields(e));
  } finally {
    sessionEnding = false;
    refuseDialogs(false);
  }
  try {
    await reportSessionEndSettled();
  } catch (e) {
    log.error("session end report failed", toErrorFields(e));
  }
}

export function useWindowClose(): void {
  // The mounted flag protects against the StrictMode mount -> cleanup -> mount
  // sequence so the listener is never double-registered or leaked.
  useEffect(() => {
    let mounted = true;
    let unlistenFn: (() => void) | null = null;
    // One close at a time: a second click (or Cmd+Q) while the first is still
    // waiting joins it rather than starting another wait and another dialog.
    let closing: Promise<boolean> | null = null;

    const stopSessionEnd = onSessionEnding(() => void endSession(closing));

    (async () => {
      const appWindow = getCurrentWindow();
      const unlisten = await appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing || sessionEnding) return;
        log.info("window close requested", {});
        try {
          closing = prepareWindowClose();
          // At the end of a session the OS ends the window, and destroying it
          // here would race that.
          if ((await closing) && !sessionEnding) {
            await appWindow.destroy();
          }
        } catch (e) {
          // A rejection from destroy() leaves the window open. Better that
          // than an unhandled rejection with preventDefault already called —
          // the user can retry the close.
          log.error("window close failed", toErrorFields(e));
        } finally {
          closing = null;
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
      stopSessionEnd();
      unlistenFn?.();
    };
  }, []);
}
