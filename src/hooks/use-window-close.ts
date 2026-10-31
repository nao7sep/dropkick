// Holds the window open until pending writes are on disk, within the exit
// deadline.
//
// Tauri would otherwise terminate the renderer the moment the OS sends the
// close request. That defeats the "writes happen immediately" promise for
// anything still in flight, and for anything committed only on blur (title /
// description inputs, inline rename) where the user closes the window while
// still focused on the field.
//
// Every quit comes here (unsaved-edits-conventions, Quitting): the red button,
// `performClose:`, Alt+F4, the app's own Quit item (Cmd+Q and the app menu,
// which the Rust core's native menu turns into a close request), and Dock >
// Quit (the Rust core's os_quit module) arrive as the close request; the end of an OS session arrives as its own event and
// settles the same writes without asking anything. Force-quit, a crash and
// power loss reach nothing.
//
// Note text not yet added or saved lasts only while Dropkick runs (developer
// decision), so an ordinary quit asks before discarding it and the end of an
// OS session discards it without asking. A title or description is ordinary
// saving: the close commits it, focused or parked (state/draft-store).
//
// The quit has one deadline, EXIT_DEADLINE_MS, fixed here when the close's
// waits start. The writes, then log forwarding, draw on it, and close_window
// hands what remains to the core, whose exit tail draws on the rest. A write
// still running at the deadline is asked about with the unsaved lists (Retry,
// Quit Anyway, Cancel). Time spent answering a question is the user's, so the
// waits after an answer start the deadline again. At the end of an OS session
// the core's own session-end wait is the deadline, and the window holds none.

import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  drainRequiredSerial,
  closeWindow,
  flushForwarded,
  log,
  onSessionEnding,
  pendingSerialKeys,
  reportSessionEndSettled,
  showQuitDiscardConfirm,
  toErrorFields,
} from "../repositories";
import { useDraftStore } from "../state/draft-store";
import { unsavedNoteText } from "../services/drafts";
import { commitParkedFields } from "../services/commit-task-fields";
import { useTaskListStore } from "../state/task-list-store";
import { useWorkspaceStore } from "../state/workspace-store";
import { useAppStateStore } from "../state/app-state-store";
import { refuseDialogs, useDialogStore } from "../state/dialog-store";

export const EXIT_DEADLINE_MS = 3000;

// True while the OS ends the session: nothing is asked, and whatever could
// not be saved before the core lets the session go is logged and left.
let sessionEnding = false;

// The work that must finish before the window is destroyed. Resolves to every
// task list or workspace left unsaved; empty when everything is on disk.
async function settlePendingWrites(): Promise<string[]> {
  // Blur first, so a field that commits on blur fires its write synchronously
  // and lands in the serial chain we are about to drain; then commit fields
  // parked without a blur, which queue there too.
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  commitParkedFields();
  // A divider or zoom step still waiting for its save delay saves now.
  useAppStateStore.getState().flushViewSteps();
  const workspace = useWorkspaceStore.getState();
  // Dismissing a structural-save notice does not make the workspace durable.
  // Use its existing full-save owner, just as switching workspaces does.
  const workspaceSaved = !workspace.loaded || await workspace.saveBeforeSwitch();
  await drainRequiredSerial();
  return [
    ...useTaskListStore.getState().unsavedPaths(),
    ...(!workspaceSaved ? [workspace.filePath] : []),
  ];
}

// Asks before an ordinary quit discards note text not yet added or saved.
// Resolves true when the close may go on. The end of a session never asks, and
// a question the session end cancels lets the close go on.
async function confirmDiscardNoteText(): Promise<boolean> {
  if (sessionEnding) return true;
  const unsaved = unsavedNoteText(
    useDraftStore.getState().drafts,
    Object.entries(useTaskListStore.getState().files).map(([sourceFile, file]) => ({ ...file.data, sourceFile })),
    Object.values(useDraftStore.getState().parkedTasks),
  );
  if (!unsaved.any) return true;
  const discard = await showQuitDiscardConfirm(unsaved.taskTitles);
  if (discard || sessionEnding) {
    log.info("window close discards unsaved note text", { tasks: unsaved.taskTitles.length });
    return true;
  }
  return false;
}

// Resolves the work's result, or "late" once the deadline (a performance.now()
// time) passes first. An Infinity deadline sets no timer.
function untilDeadline<T>(work: Promise<T>, deadline: number): Promise<T | "late"> {
  if (deadline === Infinity) return work;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("late"), Math.max(0, deadline - performance.now()));
    void work.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

// Settles pending writes before a close. Resolves the exit deadline when the
// window may be destroyed: the writes finished, the user chose to quit anyway,
// or the session is ending. Resolves null when the user chose to keep the
// window open. Exported so the close path can be exercised without driving a
// real window.
//
// Note text not yet added or saved is asked about first, so Keep Editing
// leaves everything as it was. The task lists are the user's own work, so a
// write that fails, or is still running at the deadline, holds the close and
// offers Retry or Quit Anyway (unsaved-edits-conventions, Quitting). A failed
// list save keeps its edit, so a list unsaved before the close is asked about
// too. Retry saves the unsaved lists again and waits again.
export async function prepareWindowClose(deadlineMs = EXIT_DEADLINE_MS): Promise<number | null> {
  if (!(await confirmDiscardNoteText())) return null;
  for (;;) {
    const deadline = sessionEnding ? Infinity : performance.now() + deadlineMs;
    const settled = await untilDeadline(settlePendingWrites(), deadline);
    const paths = settled !== "late" ? settled
      : [...new Set([...pendingSerialKeys(), ...useTaskListStore.getState().unsavedPaths()])];
    if (paths.length === 0) return deadline;
    if (sessionEnding) {
      log.warn("session ended with changes not saved", { paths });
      return deadline;
    }

    log.warn("window close held by changes not saved", { paths, late: settled === "late" });
    const choice = await useDialogStore.getState().enqueueQuitSave(paths);
    if (choice === "quit" || sessionEnding) {
      log.warn("window closed with changes not saved", { paths });
      return sessionEnding ? Infinity : performance.now() + deadlineMs;
    }
    if (choice === "cancel") return null;
    useTaskListStore.getState().retryUnsaved();
  }
}

// The OS is ending the session: settle, ask nothing, and tell the core, which
// lets the session go on, at the latest when its session-end wait ends. A
// close the user started that is still running is joined rather than run
// twice; its question, if on screen,
// is cancelled. The window is left for the OS to end, and if the session goes
// on after all (Windows lets another app cancel it) the app carries on as
// before.
async function endSession(running: Promise<unknown> | null): Promise<void> {
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
    let closing: Promise<number | null> | null = null;

    const stopSessionEnd = onSessionEnding(() => void endSession(closing));

    (async () => {
      const appWindow = getCurrentWindow();
      const unlisten = await appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing || sessionEnding) return;
        log.info("window close requested", {});
        try {
          let forwarded = false;
          closing = (async () => {
            const deadline = await prepareWindowClose();
            // The OS owns destruction during session end.
            if (deadline === null || sessionEnding) return deadline;
            // Forwarding draws on what remains of the deadline.
            forwarded = await flushForwarded(Math.max(0, deadline - performance.now()));
            return deadline;
          })();
          const deadline = await closing;
          if (deadline !== null && !sessionEnding) {
            await closeWindow(forwarded, Math.max(0, Math.round(deadline - performance.now())));
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
