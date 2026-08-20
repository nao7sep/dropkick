// Note drafts stored at ~/.dropkick/note-drafts.json — the user's uncommitted
// note text, kept machine-local.
//
// A draft is text typed into the new-note composer or a note editor and not yet
// saved. It is a kind of its own (persisted-store-separation conventions: "a new
// distinct kind gets a new store"): not config, because nothing here was
// authored as a setting; not view state, because it is not a presentation
// adjustment; and not part of the portable task list, because half a typed
// sentence has no business riding along when a task list is copied to another
// machine or committed to a repository. So it gets its own file under the app
// root and its own type, and the portable preferences/workspace/task-list
// documents stay untouched.
//
// Keys are the draft keys from services/note-drafts: a bare task id for that
// task's composer, `taskId:noteId` for an in-progress edit of one note.

export interface NoteDraftsDto {
  version: string;
  drafts: Record<string, string>;
}

export function createDefaultNoteDrafts(): NoteDraftsDto {
  return {
    version: "1.0.0",
    drafts: {},
  };
}
