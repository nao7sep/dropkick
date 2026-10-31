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
import { draftTaskId, draftSourceFile, draftSubjectKey, composerDraftKey, draftKeyAtPath, reconcileDrafts, canonicalDraftText, closedTaskContexts, type ParkedTaskContext, type DraftList } from "../services/drafts";
import type { ActionResult } from "./action-result";
import { nowUtc } from "../utils/dates";

interface DraftState {
  drafts: Record<string, string>;
  submittingVersions: ReadonlySet<number>;
  submitDraft: (key: string, write: (text: string, editedAtUtc: string | undefined) => Promise<ActionResult>) => Promise<ActionResult | null>;
  // Only draft subjects need context after their list closes; never persisted.
  parkedTasks: Record<string, ParkedTaskContext>;
  rememberTasks: (list: TaskListDto, sourceFile: string) => void;
  moveTaskDrafts: (taskIds: ReadonlySet<string>, sourcePath: string, destinationPath: string) => void;
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
  clearTaskDrafts: (taskId: string, sourceFile: string) => void;
  // Drop drafts whose task or note no longer exists. `subjects` is every key the
  // loaded task lists can justify (services/drafts).
  // Drops drafts whose subject is provably gone, judged against the task
  // lists currently loaded. Safe to call as often as those change.
  reconcile: (loadedLists: readonly DraftList[]) => void;
}

export const useDraftStore = create<DraftState>((set, get) => {
  let nextVersion = 0;
  const submissions = new Map<number, Promise<ActionResult | null>>();
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
    const subjects = new Set(Object.keys(drafts).map(draftSubjectKey));
    const parkedTasks = Object.fromEntries(Object.entries(previous.parkedTasks).filter(([key]) => subjects.has(key)));
    set({ drafts, draftVersions, editedAtUtc, parkedTasks });
  }

  return {
    drafts: {},
    submittingVersions: new Set(),
    submitDraft: (key, write) => {
      const state = get();
      const text = state.drafts[key];
      const version = state.draftVersions[key];
      if (text === undefined || version === undefined) return Promise.resolve(null);
      const existing = submissions.get(version);
      if (existing) return existing;
      // The receipt belongs to the draft generation, not its mounted editor or
      // path. Moving a task preserves this generation; later typing replaces it.
      const result = Promise.resolve().then(() => write(text, state.editedAtUtc[key])).then((outcome) => {
        if (outcome.status === "success" || outcome.status === "reloaded") get().clearDraftIf(key, text, version);
        return outcome;
      }).finally(() => {
        submissions.delete(version);
        set({ submittingVersions: new Set(submissions.keys()) });
      });
      submissions.set(version, result);
      set({ submittingVersions: new Set(submissions.keys()) });
      return result;
    },
    parkedTasks: {},
    rememberTasks: (list, sourceFile) => {
      const subjects = new Set(Object.keys(get().drafts).map(draftSubjectKey));
      const parkedTasks = { ...get().parkedTasks };
      for (const { id, title, notes } of list.tasks) {
        const key = composerDraftKey(id, sourceFile);
        if (subjects.has(key)) parkedTasks[key] = { id, title, notes, sourceFile };
      }
      set({ parkedTasks });
    },
    editedAtUtc: {},
    draftVersions: {},
    justOpenedKey: null,

    moveTaskDrafts: (taskIds, sourcePath, destinationPath) => {
      const state = get();
      const moved = (key: string) => draftSourceFile(key) === sourcePath && taskIds.has(draftTaskId(key)) ? draftKeyAtPath(key, destinationPath) : key;
      // The move owner refuses destination draft collisions before publishing.
      // Preserve timestamps and receipt generations, including typing during I/O.
      const remap = <T,>(values: Record<string, T>) => Object.fromEntries(Object.entries(values).map(([key, value]) => [moved(key), value]));
      set({ drafts: remap(state.drafts), editedAtUtc: remap(state.editedAtUtc), draftVersions: remap(state.draftVersions),
        justOpenedKey: state.justOpenedKey === null ? null : moved(state.justOpenedKey) });
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
      const state = get();
      let currentKey = key;
      if (state.drafts[key] !== expected || state.draftVersions[key] !== version) {
        // A successful move preserves the globally unique receipt generation
        // while changing its path. Later typing always owns a new generation.
        const moved = version === undefined ? undefined : Object.keys(state.drafts)
          .find((candidate) => state.draftVersions[candidate] === version && state.drafts[candidate] === expected);
        if (moved === undefined) return false;
        currentKey = moved;
      }
      get().clearDraft(currentKey);
      return true;
    },

    clearDraft: (key) => {
      const { drafts } = get();
      if (!(key in drafts)) return;
      const { [key]: _removed, ...rest } = drafts;
      commit(rest);
    },

    clearTaskDrafts: (taskId, sourceFile) => {
      const { drafts } = get();
      const rest = Object.fromEntries(
        Object.entries(drafts).filter(([key]) => draftTaskId(key) !== taskId
          || draftSourceFile(key) !== sourceFile),
      );
      if (Object.keys(rest).length === Object.keys(drafts).length) return;
      commit(rest);
    },

    reconcile: (loadedLists) => {
      const { drafts, parkedTasks } = get();
      const closed = closedTaskContexts(loadedLists, Object.values(parkedTasks));
      if (closed.length !== Object.keys(parkedTasks).length) {
        set({ parkedTasks: Object.fromEntries(closed.map((task) => [composerDraftKey(task.id, task.sourceFile), task])) });
      }
      const kept = reconcileDrafts(drafts, loadedLists, closed);
      if (kept === drafts) return;
      log.info("orphaned drafts dropped", {
        dropped: Object.keys(drafts).length - Object.keys(kept).length,
      });
      commit(kept);
    },
  };
});
