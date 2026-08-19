// Session-scoped note drafts.
//
// Text a user has typed but not yet saved — the new-note composer and an
// in-progress note edit — must outlive the component showing it, because that
// component's lifetime is decided by selection: switching tasks, cycling tabs,
// or a bulk action unmounts the detail pane and would silently drop the text
// (modal-dialog-conventions, Unsaved Edits Outside a Modal). Drafts therefore
// live here, in memory for the session, and the components are just views onto
// them: leaving a task parks its draft, coming back restores it, and only
// quitting the app — the one exit that ends the session — asks first.
//
// Keys deliberately omit the file path. Task ids are stable per-entity nanoids,
// so a draft follows its task when the task is moved to another list and
// reappears when a closed tab is reopened. An entry records the baseline the
// draft started from; a draft is "unsaved work" only when its cleaned text
// differs from its cleaned baseline, so an untouched edit or a whitespace-only
// composer never blocks quitting.

import { create } from "zustand";
import { multiline } from "../utils";

export interface DraftEntry {
  text: string;
  // What the draft started from: "" for the composer, the note's content for an
  // edit. Dirtiness is a comparison against this, not mere presence.
  baseline: string;
}

// The new-note composer draft for a task.
export function composerDraftKey(taskId: string): string {
  return taskId;
}

// An in-progress edit of an existing note. ":" is outside the nanoid
// alphabet, so editor keys can never collide with composer keys or each other.
export function editorDraftKey(taskId: string, noteId: string): string {
  return `${taskId}:${noteId}`;
}

// Unsaved means the cleaned text differs from the cleaned baseline.
export function isDraftDirty(entry: DraftEntry): boolean {
  return multiline(entry.text) !== multiline(entry.baseline);
}

export function hasUnsavedDrafts(drafts: Record<string, DraftEntry>): boolean {
  return Object.values(drafts).some(isDraftDirty);
}

interface NoteDraftState {
  drafts: Record<string, DraftEntry>;
  // Seed a draft with an explicit baseline (opening a note editor).
  beginDraft: (key: string, baseline: string) => void;
  // Update a draft's text, creating it with an empty baseline if absent (the
  // composer has no explicit open moment — the first keystroke creates it).
  updateDraft: (key: string, text: string) => void;
  clearDraft: (key: string) => void;
  // Drop a task's composer draft and all its note-edit drafts. Called when the
  // task is deleted — the drafts' subject no longer exists.
  clearTaskDrafts: (taskId: string) => void;
}

export const useNoteDraftStore = create<NoteDraftState>((set) => ({
  drafts: {},

  beginDraft: (key, baseline) =>
    set((s) => ({
      drafts: { ...s.drafts, [key]: { text: baseline, baseline } },
    })),

  updateDraft: (key, text) =>
    set((s) => ({
      drafts: {
        ...s.drafts,
        [key]: { text, baseline: s.drafts[key]?.baseline ?? "" },
      },
    })),

  clearDraft: (key) =>
    set((s) => {
      if (!(key in s.drafts)) return s;
      const { [key]: _removed, ...rest } = s.drafts;
      return { drafts: rest };
    }),

  clearTaskDrafts: (taskId) =>
    set((s) => {
      const editorPrefix = `${taskId}:`;
      const rest = Object.fromEntries(
        Object.entries(s.drafts).filter(
          ([key]) => key !== taskId && !key.startsWith(editorPrefix),
        ),
      );
      return { drafts: rest };
    }),
}));
