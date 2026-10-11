// Session draft identity includes the source copy. An interrupted move can
// leave the same task/note IDs in two files; their authored text is independent.
// Successful moves transfer draft keys at the same settlement boundary as data.
import type { TaskListDto, TaskDto } from "../models";
import { singleLine, multiline } from "../utils/textCleanup";

export type DraftList = TaskListDto & { sourceFile: string };
export type ParkedTaskContext = Pick<TaskDto, "id" | "title" | "notes"> & { sourceFile: string };
export type TaskField = "title" | "description";

function inCopy(key: string, sourceFile: string): string {
  return `${key}|${encodeURIComponent(sourceFile)}`;
}
function localKey(key: string): string { return key.split("|", 1)[0]; }
export function draftSourceFile(key: string): string | undefined {
  const separator = key.indexOf("|");
  return separator === -1 ? undefined : decodeURIComponent(key.slice(separator + 1));
}
export function draftKeyAtPath(key: string, sourceFile: string): string {
  return inCopy(localKey(key), sourceFile);
}
export function composerDraftKey(taskId: string, sourceFile: string): string {
  return inCopy(taskId, sourceFile);
}
export function editorDraftKey(taskId: string, noteId: string, sourceFile: string): string {
  return inCopy(`${taskId}:${noteId}`, sourceFile);
}
export function fieldDraftKey(taskId: string, field: TaskField, sourceFile: string): string {
  return inCopy(`${taskId}#${field}`, sourceFile);
}
export function draftTaskId(key: string): string {
  const local = localKey(key);
  const end = local.search(/[:#]/);
  return end === -1 ? local : local.slice(0, end);
}
export function draftSubjectKey(key: string): string {
  const path = draftSourceFile(key);
  return path === undefined ? draftTaskId(key) : composerDraftKey(draftTaskId(key), path);
}
export function draftField(key: string): TaskField | null {
  const local = localKey(key);
  return local.endsWith("#title") ? "title" : local.endsWith("#description") ? "description" : null;
}
function draftNoteId(key: string): string | undefined {
  const local = localKey(key);
  const separator = local.indexOf(":");
  return separator === -1 ? undefined : local.slice(separator + 1);
}
export function canonicalDraftText(key: string, text: string): string {
  return draftField(key) === "title" ? singleLine(text, { minify: true }) : multiline(text);
}
export function holdsDraftFor(drafts: Record<string, string>, tasks: readonly { id: string }[], sourceFile?: string): boolean {
  const ids = new Set(tasks.map((task) => task.id));
  return Object.keys(drafts).some((key) => ids.has(draftTaskId(key))
    && (sourceFile === undefined || draftSourceFile(key) === sourceFile));
}
export function closedTaskContexts(loadedLists: readonly DraftList[], parkedTasks: readonly ParkedTaskContext[]): ParkedTaskContext[] {
  const loaded = new Set(loadedLists.map((list) => list.sourceFile));
  return parkedTasks.filter((task) => !loaded.has(task.sourceFile));
}

// The same copy identity owns text, retained context, reconciliation and quit.
function taskContexts(loadedLists: readonly DraftList[], parkedTasks: readonly ParkedTaskContext[]) {
  const bySubject = new Map<string, Pick<TaskDto, "id" | "title" | "notes">>();
  for (const task of closedTaskContexts(loadedLists, parkedTasks)) bySubject.set(composerDraftKey(task.id, task.sourceFile), task);
  for (const list of loadedLists) for (const task of list.tasks) bySubject.set(composerDraftKey(task.id, list.sourceFile), task);
  return bySubject;
}

// Closed lists are not deletions. Drop an editor only when its own visible or
// retained task proves the note gone. Unknown subjects last until quit.
export function reconcileDrafts(drafts: Record<string, string>, loadedLists: readonly DraftList[], parkedTasks: readonly ParkedTaskContext[] = []): Record<string, string> {
  const contexts = taskContexts(loadedLists, parkedTasks);
  const kept = Object.entries(drafts).filter(([key]) => {
    const noteId = draftNoteId(key);
    if (noteId === undefined) return true;
    const task = contexts.get(draftSubjectKey(key));
    return task === undefined || task.notes.some((note) => note.id === noteId);
  });
  return kept.length === Object.keys(drafts).length ? drafts : Object.fromEntries(kept);
}

// Ordinary fields save at quit. Only composers and changed note edits require
// a discard question, named from their own loaded or closed copy.
export function unsavedNoteText(drafts: Record<string, string>, loadedLists: readonly DraftList[], parkedTasks: readonly ParkedTaskContext[] = []): { any: boolean; taskTitles: string[] } {
  const contexts = taskContexts(loadedLists, parkedTasks);
  let any = false;
  const titles = new Set<string>();
  for (const [key, text] of Object.entries(drafts)) {
    if (draftField(key) !== null) continue;
    const task = contexts.get(draftSubjectKey(key));
    const noteId = draftNoteId(key);
    const note = noteId === undefined ? undefined : task?.notes.find((note) => note.id === noteId);
    const unsaved = noteId === undefined ? multiline(text).trim() !== ""
      : task === undefined || (note !== undefined && multiline(text) !== note.content);
    if (!unsaved) continue;
    any = true;
    if (task !== undefined) titles.add(task.title);
  }
  return { any, taskTitles: [...titles] };
}
