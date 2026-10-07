// Task drafts — written through to disk as the user types.
//
// Text a user has typed but not yet saved — the new-note composer, an
// in-progress note edit, and a task's title or description while its field is
// being edited — must outlive the component showing it, because that
// component's lifetime is decided by selection: switching tasks, cycling tabs,
// or a bulk action unmounts the detail pane and would silently drop the text
// (modal-dialog-conventions, Unsaved Edits Outside a Modal). Drafts therefore
// live here, and the components are just views onto them: leaving a task parks
// its draft and coming back restores it.
//
// They are also PERSISTED, and that is the point. Every quit reaches the
// window's close path (hooks/use-window-close), but force-quit, a crash and
// power loss reach no guard at all, so writing through is what keeps the text,
// and the close asks about drafts only when writing them failed. Title and
// description commit on blur, which none of those exits fires, so they are
// written through here for the same reason (services/note-drafts has the key
// grammar).
//
// The write is coalesced (see below) rather than fired per keystroke, so the
// residual exposure is the coalescing window, not the session.

import { create } from "zustand";
import type { TaskListDto } from "../models";
import {
  flushNoteDrafts,
  loadNoteDrafts,
  log,
  toErrorFields,
  type NoteDraftsLoadFailure,
} from "../repositories";
import { draftTaskId, reconcileDrafts, canonicalDraftText } from "../services/note-drafts";
import { nowUtc } from "../utils/dates";

// Coalescing window for the write-through.
//
// IDLE is the trailing debounce: a burst of typing settles into one write half
// a second after the last keystroke, which is what makes the store cheap enough
// to write on every change. MAX_WAIT bounds the case IDLE alone cannot cover —
// sustained typing with no pause long enough to trigger it — so text can never
// sit unwritten for longer than that however the user types.
//
// Together they set the only remaining exposure: an ungraceful exit (force-quit,
// crash, power loss) can lose at most the keystrokes typed since
// the last write. A graceful close closes even that window by flushing before
// the window is destroyed (hooks/use-window-close).
const WRITE_IDLE_MS = 500;
const WRITE_MAX_WAIT_MS = 3000;

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let coalesceStartedAt = 0;
// True from a change until a write started after it succeeds, so a failed
// write stays owed rather than being taken for a current disk copy.
let unwritten = false;
// The latest write, so a flush waits for one already under way.
let latestWrite: Promise<boolean> = Promise.resolve(true);

function schedulePersist(): void {
  // No path means the drafts have not been loaded; nothing is written before
  // the file has been read.
  if (!useNoteDraftStore.getState().filePath) return;

  unwritten = true;
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

// Resolves true when the drafts reached the disk.
function persist(): Promise<boolean> {
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  unwritten = false;
  const { filePath } = useNoteDraftStore.getState();
  if (!filePath) return Promise.resolve(true);
  latestWrite = flushNoteDrafts(filePath, () => useNoteDraftStore.getState().drafts,
    () => useNoteDraftStore.getState().editedAtUtc).then(
    () => true,
    (e: unknown) => {
      // A failed draft write is logged, not raised: an alert per keystroke
      // would be disruptive. The drafts stay owed, so the next change writes
      // them again and a graceful close holds until they are written or the
      // user quits anyway (hooks/use-window-close).
      unwritten = true;
      log.warn("note drafts write failed", { filePath, ...toErrorFields(e) });
      return false;
    },
  );
  return latestWrite;
}

// Writes any change not yet on disk immediately, after a write already under
// way. Used on the graceful close path so the last keystrokes land before the
// window is destroyed. Resolves false when the drafts could not be written.
// With nothing owed the disk copy is already current, so this costs nothing —
// closing a session that typed no drafts must not rewrite the file.
export async function flushNoteDraftsNow(): Promise<boolean> {
  await latestWrite;
  if (writeTimer === null && !unwritten) return true;
  return await persist();
}

interface NoteDraftState {
  drafts: Record<string, string>;
  editedAtUtc: Record<string, string>;
  draftVersions: Record<string, number>;
  // Path of ~/.dropkick/note-drafts.json once loaded, "" before.
  filePath: string;
  loaded: boolean;

  // Reads the persisted drafts. Returns the failure, with nothing loaded, when
  // the file exists but cannot be used, so the caller can halt and say so.
  load: () => Promise<NoteDraftsLoadFailure | null>;
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
  // Clear only the generation captured when the write started. Later typing
  // remains a draft, including A/B/A edits returning to the submitted text.
  // Returns whether the submitted draft was cleared.
  clearDraftIf: (key: string, expected: string, version: number | undefined) => boolean;
  // Drop every draft of a task: composer, note edits, title and description.
  // Called when the task is deleted — the drafts' subject no longer exists.
  clearTaskDrafts: (taskId: string) => void;
  // Drop drafts whose task or note no longer exists. `subjects` is every key the
  // loaded task lists can justify (services/note-drafts).
  // Drops drafts whose subject is provably gone, judged against the task
  // lists currently loaded. Safe to call as often as those change.
  reconcile: (loadedLists: readonly TaskListDto[]) => void;
}

export const useNoteDraftStore = create<NoteDraftState>((set, get) => {
  let nextVersion = 0;
  // Replace the draft map and schedule a write, unless nothing changed — a
  // no-op must not cost a disk write.
  function commit(drafts: Record<string, string>): void {
    if (drafts === get().drafts) return;
    const previous = get();
    const draftVersions = Object.fromEntries(Object.keys(drafts).map((key) => [
      key,
      drafts[key] === previous.drafts[key] && previous.draftVersions[key] !== undefined
        ? previous.draftVersions[key]
        : ++nextVersion,
    ]));
    const editedAtUtc = Object.fromEntries(Object.keys(drafts).map((key) => [key,
      previous.editedAtUtc[key] !== undefined
        && canonicalDraftText(key, drafts[key]) === canonicalDraftText(key, previous.drafts[key] ?? "")
        ? previous.editedAtUtc[key] : nowUtc(),
    ]));
    set({ drafts, draftVersions, editedAtUtc });
    schedulePersist();
  }

  return {
    drafts: {},
    editedAtUtc: {},
    draftVersions: {},
    filePath: "",
    loaded: false,
    justOpenedKey: null,

    load: async () => {
      const result = await loadNoteDrafts();
      if (result.status !== "success") return result;
      // Loading replaces the draft world, so a mark naming an editor from
      // before it is meaningless and must not survive.
      set({ drafts: result.drafts, editedAtUtc: result.editedAtUtc, draftVersions: Object.fromEntries(
        Object.keys(result.drafts).map((key) => [key, ++nextVersion]),
      ), filePath: result.filePath, loaded: true, justOpenedKey: null });
      return null;
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

    clearDraftIf: (key, expected, version) => {
      if (get().drafts[key] !== expected || get().draftVersions[key] !== version) return false;
      get().clearDraft(key);
      return true;
    },

    clearDraft: (key) => {
      const { drafts } = get();
      if (!(key in drafts)) return;
      const { [key]: _removed, ...rest } = drafts;
      commit(rest);
    },

    clearTaskDrafts: (taskId) => {
      const { drafts } = get();
      const rest = Object.fromEntries(
        Object.entries(drafts).filter(([key]) => draftTaskId(key) !== taskId),
      );
      if (Object.keys(rest).length === Object.keys(drafts).length) return;
      commit(rest);
    },

    reconcile: (loadedLists) => {
      const { drafts } = get();
      const kept = reconcileDrafts(drafts, loadedLists);
      if (kept === drafts) return;
      log.info("orphaned note drafts dropped", {
        dropped: Object.keys(drafts).length - Object.keys(kept).length,
      });
      commit(kept);
    },
  };
});
