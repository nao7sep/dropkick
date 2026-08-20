// Pure note-draft rules: the key grammar, and the load-time reconciliation that
// drops drafts whose subject no longer exists.
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

// Every draft key the given task lists can justify: one per task (its composer)
// and one per note (its editor). A draft key outside this set has no subject.
export function collectDraftSubjects(
  taskLists: readonly TaskListDto[],
): Set<string> {
  const subjects = new Set<string>();
  for (const list of taskLists) {
    for (const task of list.tasks) {
      subjects.add(composerDraftKey(task.id));
      for (const note of task.notes) {
        subjects.add(editorDraftKey(task.id, note.id));
      }
    }
  }
  return subjects;
}

// Drops every draft whose task or note no longer exists. Drafts persist across
// sessions, so without this a note deleted (or a task deleted from another tab)
// leaves its draft behind forever — text the user cannot locate from any
// surface, growing the store one orphan at a time.
//
// Returns the SAME object when nothing was dropped, so the caller can skip both
// the state update and the disk write on the overwhelmingly common no-op.
export function reconcileDrafts(
  drafts: Record<string, string>,
  subjects: ReadonlySet<string>,
): Record<string, string> {
  const kept = Object.entries(drafts).filter(([key]) => subjects.has(key));
  if (kept.length === Object.keys(drafts).length) return drafts;
  return Object.fromEntries(kept);
}

// The safety gate around reconciliation: which subjects may be used, or `null`
// for "not now".
//
// Reconciliation can only DROP drafts, so it must never run against a partial
// picture. It is allowed exactly when every open task list has loaded — then a
// draft key outside their union genuinely has no subject to return to. If a
// list is still loading, failed to load, or no list is open at all, the union
// would be missing tasks that do exist and the answer is `null`: keep every
// draft and try again once the picture is complete.
export function draftReconcileSubjects(
  openListPaths: readonly string[],
  files: Readonly<Record<string, { data: TaskListDto }>>,
): Set<string> | null {
  if (openListPaths.length === 0) return null;
  const loaded: TaskListDto[] = [];
  for (const path of openListPaths) {
    const file = files[path];
    if (!file) return null;
    loaded.push(file.data);
  }
  return collectDraftSubjects(loaded);
}
