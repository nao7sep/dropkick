import { useNoteDraftStore } from "../state/note-draft-store";
import { useTaskListStore } from "../state/task-list-store";
import { draftTaskId, draftField, draftSourceFile } from "./note-drafts";
import { multiline, singleLine } from "../utils/textCleanup";

// Commits every title and description draft still in the draft store, as its
// blur would have: a field whose pane went away without a blur parks its text
// there, and nothing else would save it before the session ends. An empty
// title is not allowed, so its draft is dropped and the title stays.
export function commitParkedFields(onlyPath?: string): void {
  const drafts = useNoteDraftStore.getState();
  const lists = useTaskListStore.getState();
  for (const [key, typed] of Object.entries(drafts.drafts)) {
    const field = draftField(key);
    if (field === null) continue;
    const taskId = draftTaskId(key);
    const matches = Object.keys(lists.files)
      .filter((path) => lists.files[path].data.tasks.some((task) => task.id === taskId));
    const owner = draftSourceFile(key);
    const filePath = owner !== undefined && matches.includes(owner) ? owner : undefined;
    if (!filePath || (onlyPath !== undefined && filePath !== onlyPath)) continue;
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
