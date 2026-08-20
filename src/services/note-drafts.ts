// Pure note-draft rules: the key grammar, and the reconciliation that drops
// drafts whose subject is provably gone.
//
// Keys deliberately omit the file path. Task ids are stable per-entity nanoids,
// so a draft follows its task when the task is moved to another list.

import type { TaskListDto } from "../models";

// The new-note composer draft for a task.
export function composerDraftKey(taskId: string): string {
  return taskId;
}

// An in-progress edit of an existing note. ":" is outside the nanoid alphabet,
// so editor keys can never collide with composer keys or each other.
export function editorDraftKey(taskId: string, noteId: string): string {
  return `${taskId}:${noteId}`;
}

// Drops only the drafts whose subject is PROVABLY gone, judged against whatever
// task lists happen to be loaded.
//
// An editor draft names both a task and a note. If that task is in front of us
// and the note is not, the note is genuinely deleted and the draft has nowhere
// to return to. Everything else is kept: a composer draft's subject is the task
// itself, and a task we cannot see is a task we cannot judge.
//
// That asymmetry is the point. The previous rule collected the subjects of the
// OPEN lists and dropped every draft outside that set, gated on all of them
// having loaded. But "open" is not "every list a draft could belong to": a
// draft key deliberately omits its path so it can follow its task between
// lists, so a draft for a task in a list the user merely closed was
// indistinguishable from an orphan — and drafts live in one machine-global file
// while workspaces are per-file, so opening a second workspace destroyed the
// first's unsaved text. Judging only what is visible needs no completeness gate
// at all, and can be run as often as the loaded lists change.
//
// The residue is a composer draft for a task deleted outside this app's own
// delete path (which clears drafts itself). That costs a few unreachable bytes
// in a JSON file; the rule it replaces cost the user text they had typed.
//
// Returns the SAME object when nothing was dropped, so the caller can skip both
// the state update and the disk write on the overwhelmingly common no-op.
export function reconcileDrafts(
  drafts: Record<string, string>,
  loadedLists: readonly TaskListDto[],
): Record<string, string> {
  const notesByTask = new Map<string, Set<string>>();
  for (const list of loadedLists) {
    for (const task of list.tasks) {
      notesByTask.set(task.id, new Set(task.notes.map((n) => n.id)));
    }
  }

  const kept = Object.entries(drafts).filter(([key]) => {
    const separator = key.indexOf(":");
    if (separator === -1) return true; // composer draft — its subject is the task
    const notes = notesByTask.get(key.slice(0, separator));
    if (notes === undefined) return true; // task not visible — not judgeable
    return notes.has(key.slice(separator + 1));
  });

  if (kept.length === Object.keys(drafts).length) return drafts;
  return Object.fromEntries(kept);
}
