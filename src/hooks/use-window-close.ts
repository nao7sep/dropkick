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
// power loss reach nothing.
//
// Note text not yet added or saved lasts only while Dropkick runs (developer
// decision), so an ordinary quit asks before discarding it and the end of an
// OS session discards it without asking. A title or description is ordinary
// saving: the close commits it, focused or parked (state/note-draft-store).
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
  showQuitDiscardConfirm,
  toErrorFields,
} from "../repositories";
import { useNoteDraftStore } from "../state/note-draft-store";
import { draftTaskId, unsavedNoteText } from "../services/note-drafts";
import { multiline, singleLine } from "../utils/textCleanup";
import { useTaskListStore } from "../state/task-list-store";
import { refuseDialogs, showAppConfirm, useDialogStore } from "../state/dialog-store";
import { message } from "../i18n/translate";

export const CLOSE_WAIT_MS = 3000;

// True while the OS ends the session: nothing is asked, and whatever could
// not be saved within the bound is logged and left.
let sessionEnding = false;

// Commits every title and description draft still in the draft store, as its
// blur would have: a field whose pane went away without a blur parks its text
// there, and nothing else would save it before the session ends. An empty
// title is not allowed, so its draft is dropped and the title stays.
function commitParkedFields(): void {
  const drafts = useNoteDraftStore.getState();
  const lists = useTaskListStore.getState();
  for (const [key, typed] of Object.entries(drafts.drafts)) {
    const field = key.endsWith("#title") ? "title" : key.endsWith("#description") ? "description" : null;
    if (field === null) continue;
    const taskId = draftTaskId(key);
    const filePath = Object.keys(lists.files)
      .find((path) => lists.files[path].data.tasks.some((task) => task.id === taskId));
    const task = filePath && lists.files[filePath].data.tasks.find((t) => t.id === taskId);
    if (filePath && task) {
      const editedAtUtc = drafts.editedAtUtc[key];
      if (field === "title") {
        const cleaned = singleLine(typed, { minify: true });
        if (cleaned && cleaned !== task.title) void lists.updateTitle(filePath, taskId, cleaned, editedAtUtc);
      } else {
        const cleaned = multiline(typed);
        if (cleaned !== task.description) void lists.updateDescription(filePath, taskId, cleaned, editedAtUtc);
      }
    }
    drafts.clearDraftIf(key, typed, drafts.draftVersions[key]);
  }
}

// The work that must finish before the window is destroyed. Resolves to every
// task list left unsaved; empty when everything is on disk.
async function settlePendingWrites(): Promise<string[]> {
  // Blur first, so a field that commits on blur fires its write synchronously
  // and lands in the serial chain we are about to drain; then commit fields
  // parked without a blur, which queue there too.
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  commitParkedFields();
  await drainAllSerial();
  return useTaskListStore.getState().unsavedPaths();
}

// Asks before an ordinary quit discards note text not yet added or saved.
// Resolves true when the close may go on. The end of a session never asks, and
// a question the session end cancels lets the close go on.
async function confirmDiscardNoteText(): Promise<boolean> {
  if (sessionEnding) return true;
  const unsaved = unsavedNoteText(
    useNoteDraftStore.getState().drafts,
    Object.values(useTaskListStore.getState().files).map((file) => file.data),
  );
  if (!unsaved.any) return true;
  const discard = await showQuitDiscardConfirm(unsaved.taskTitles);
  if (discard || sessionEnding) {
    log.info("window close discards unsaved note text", { tasks: unsaved.taskTitles.length });
    return true;
  }
  return false;
}

function within(work: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    void work.then(() => {
      clearTimeout(timer);
      resolve(true);
    }, () => {
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
// Note text not yet added or saved is asked about first, so Keep Editing
// leaves everything as it was. The task lists are the user's own work, so a
// write that fails holds the close and offers Retry or Quit Anyway
// (unsaved-edits-conventions, Quitting). A failed list save keeps its edit, so
// a list unsaved before the close is asked about too. Retry saves the unsaved
// lists again and runs the whole bounded settle again.
export async function prepareWindowClose(waitMs = CLOSE_WAIT_MS): Promise<boolean> {
  if (!(await confirmDiscardNoteText())) return false;
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
    const choice = await useDialogStore.getState().enqueueQuitSave(paths);
    if (choice === "quit" || sessionEnding) {
      log.warn("window closed with changes not saved", { paths });
      return true;
    }
    if (choice === "cancel") return false;
    useTaskListStore.getState().retryUnsaved();
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
    settled.then(() => "settled" as const, () => "settled" as const),
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
