// Task drafts — typed text that outlives the component showing it.
//
// Text a user has typed but not yet saved — the new-note composer, an
// in-progress note edit, and a task's title or description while its field is
// being edited — must outlive the component showing it, because that
// component's lifetime is decided by selection: switching tasks, cycling tabs,
// or a bulk action unmounts the detail pane and would silently drop the text
// (unsaved-edits-conventions, Editing lifetime). Drafts therefore live here,
// and the components are just views onto them: leaving a task parks its draft
// and coming back restores it.
//
// They last only while Dropkick runs (developer decision): note text not yet
// added or saved does not come back after quit, a crash or a restart, and an
// ordinary quit asks before discarding it (hooks/use-window-close). Title and
// description are ordinary saving, committed on blur, and a quit commits any
// still parked here.

import { create } from "zustand";
import type { TaskListDto } from "../models";
import { log } from "../repositories";
import { draftTaskId, reconcileDrafts, canonicalDraftText } from "../services/note-drafts";
import { nowUtc } from "../utils/dates";

interface NoteDraftState {
  drafts: Record<string, string>;
  editedAtUtc: Record<string, string>;
  draftVersions: Record<string, number>;

  // Create or update a draft. The composer has no explicit open moment — its
  // first keystroke creates it.
  setDraft: (key: string, text: string) => void;
  // Open a note editor: seed the draft with the note's text and mark it as the
  // one the user just opened. Distinct from `setDraft` because opening and
  // typing are different events, and only the first should take focus.
  openDraft: (key: string, text: string) => void;
  // The editor the user just opened, or null. Transient:
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
  // Replace the draft map, unless nothing changed.
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
  }

  return {
    drafts: {},
    editedAtUtc: {},
    draftVersions: {},
    justOpenedKey: null,

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
