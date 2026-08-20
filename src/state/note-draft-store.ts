// Note drafts — written through to disk as the user types.
//
// Text a user has typed but not yet saved — the new-note composer and an
// in-progress note edit — must outlive the component showing it, because that
// component's lifetime is decided by selection: switching tasks, cycling tabs,
// or a bulk action unmounts the detail pane and would silently drop the text
// (modal-dialog-conventions, Unsaved Edits Outside a Modal). Drafts therefore
// live here, and the components are just views onto them: leaving a task parks
// its draft and coming back restores it.
//
// They are also PERSISTED, and that is the point. An earlier design kept them
// in memory and asked at quit through the window's close-request handler. On
// macOS that handler is never reached by Cmd+Q, the app menu, or Dock > Quit:
// tao emits CloseRequested only from `windowShouldClose:` (the red button and
// `performClose:`), the app installs no menu so Tauri's default is used and its
// Quit maps to `terminate:`, and nothing in tao, wry, tauri or tauri-runtime-wry
// implements `applicationShouldTerminate:`. The reflex quit on the primary
// platform therefore ran straight to exit with the drafts still in memory —
// and force-quit, a crash and power loss are unreachable by any guard at all.
// Writing through removes the whole class instead of plugging one route, so
// there is no quit prompt any more: nothing is held back to ask about.
//
// The write is coalesced (see below) rather than fired per keystroke, so the
// residual exposure is the coalescing window, not the session.

import { create } from "zustand";
import { flushNoteDrafts, loadNoteDrafts, log, toErrorFields } from "../repositories";
import { reconcileDrafts } from "../services/note-drafts";

// Coalescing window for the write-through.
//
// IDLE is the trailing debounce: a burst of typing settles into one write half
// a second after the last keystroke, which is what makes the store cheap enough
// to write on every change. MAX_WAIT bounds the case IDLE alone cannot cover —
// sustained typing with no pause long enough to trigger it — so text can never
// sit unwritten for longer than that however the user types.
//
// Together they set the only remaining exposure: an ungraceful exit (Cmd+Q,
// force-quit, crash, power loss) can lose at most the keystrokes typed since
// the last write. A graceful close closes even that window by flushing before
// the window is destroyed (hooks/use-window-close).
const WRITE_IDLE_MS = 500;
const WRITE_MAX_WAIT_MS = 3000;

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let coalesceStartedAt = 0;

function schedulePersist(): void {
  // No path means the file could not be read; keep drafts in memory rather than
  // writing over bytes we failed to read.
  if (!useNoteDraftStore.getState().filePath) return;

  const now = Date.now();
  if (writeTimer === null) {
    coalesceStartedAt = now;
  } else {
    clearTimeout(writeTimer);
  }
  const remainingMax = Math.max(0, WRITE_MAX_WAIT_MS - (now - coalesceStartedAt));
  writeTimer = setTimeout(() => {
    void persist();
  }, Math.min(WRITE_IDLE_MS, remainingMax));
}

async function persist(): Promise<void> {
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const { filePath } = useNoteDraftStore.getState();
  if (!filePath) return;
  try {
    await flushNoteDrafts(filePath, () => useNoteDraftStore.getState().drafts);
  } catch (e) {
    // A failed draft write is logged, not raised. The text is still on screen
    // and still in memory, and every write the user actually asked for (adding
    // a note, editing a task) reports its own failure through the existing
    // dialogs — so a broken disk is never silent, and a modal per keystroke
    // would be.
    log.warn("note drafts write failed", { filePath, ...toErrorFields(e) });
  }
}

// Writes any coalesced change immediately. Used on the graceful close path so
// the last keystrokes land before the window is destroyed. With nothing
// coalescing the disk copy is already current, so this costs nothing — closing
// a session that typed no drafts must not rewrite the file.
export async function flushNoteDraftsNow(): Promise<void> {
  if (writeTimer === null) return;
  await persist();
}

interface NoteDraftState {
  drafts: Record<string, string>;
  // Path of ~/.dropkick/note-drafts.json, or "" when persistence is disabled
  // for this session (the file exists but could not be read).
  filePath: string;
  loaded: boolean;

  // Reads the persisted drafts. Returns the `.invalid` path when a corrupt file
  // was quarantined, so the caller can name it to the user.
  load: () => Promise<string | null>;
  // Create or update a draft. The composer has no explicit open moment — its
  // first keystroke creates it.
  setDraft: (key: string, text: string) => void;
  // Open a note editor: seed the draft with the note's text and mark it as the
  // one the user just opened. Distinct from `setDraft` because opening and
  // typing are different events, and only the first should take focus.
  openDraft: (key: string, text: string) => void;
  // The editor the user just opened, or null. Transient and never persisted:
  // it exists for exactly one render, so a remount cannot re-steal focus.
  justOpenedKey: string | null;
  clearJustOpened: () => void;
  clearDraft: (key: string) => void;
  // Clear only if the draft still reads as it did when the write was started.
  // A keystroke typed during that await is newer than what was committed, so
  // clearing unconditionally would eat it.
  clearDraftIf: (key: string, expected: string) => void;
  // Drop a task's composer draft and all its note-edit drafts. Called when the
  // task is deleted — the drafts' subject no longer exists.
  clearTaskDrafts: (taskId: string) => void;
  // Drop drafts whose task or note no longer exists. `subjects` is every key the
  // loaded task lists can justify (services/note-drafts).
  reconcile: (subjects: ReadonlySet<string>) => void;
}

export const useNoteDraftStore = create<NoteDraftState>((set, get) => {
  // Replace the draft map and schedule a write, unless nothing changed — a
  // no-op must not cost a disk write.
  function commit(drafts: Record<string, string>): void {
    if (drafts === get().drafts) return;
    set({ drafts });
    schedulePersist();
  }

  return {
    drafts: {},
    filePath: "",
    loaded: false,
    justOpenedKey: null,

    load: async () => {
      const { drafts, filePath, quarantinedTo } = await loadNoteDrafts();
      // Loading replaces the draft world, so a mark naming an editor from
      // before it is meaningless and must not survive.
      set({ drafts, filePath, loaded: true, justOpenedKey: null });
      return quarantinedTo;
    },

    setDraft: (key, text) => {
      const { drafts } = get();
      if (drafts[key] === text) return;
      commit({ ...drafts, [key]: text });
    },

    openDraft: (key, text) => {
      const { drafts } = get();
      set({ justOpenedKey: key });
      if (drafts[key] === text) return;
      commit({ ...drafts, [key]: text });
    },

    clearJustOpened: () => {
      if (get().justOpenedKey !== null) set({ justOpenedKey: null });
    },

    clearDraftIf: (key, expected) => {
      if (get().drafts[key] !== expected) return;
      get().clearDraft(key);
    },

    clearDraft: (key) => {
      const { drafts } = get();
      if (!(key in drafts)) return;
      const { [key]: _removed, ...rest } = drafts;
      commit(rest);
    },

    clearTaskDrafts: (taskId) => {
      const { drafts } = get();
      const editorPrefix = `${taskId}:`;
      const rest = Object.fromEntries(
        Object.entries(drafts).filter(
          ([key]) => key !== taskId && !key.startsWith(editorPrefix),
        ),
      );
      if (Object.keys(rest).length === Object.keys(drafts).length) return;
      commit(rest);
    },

    reconcile: (subjects) => {
      const { drafts } = get();
      const kept = reconcileDrafts(drafts, subjects);
      if (kept === drafts) return;
      log.info("orphaned note drafts dropped", {
        dropped: Object.keys(drafts).length - Object.keys(kept).length,
      });
      commit(kept);
    },
  };
});
