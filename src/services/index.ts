export type { GroupedTasks } from "./grouping";
export type { LoadedFiles } from "./grouping";
export {
  groupTasks,
  collectViewTasks,
  visualTaskOrder,
} from "./grouping";

export type { ListUrgency } from "./list-urgency";
export { computeListUrgency, computeTabUrgencies } from "./list-urgency";

export type { UnifiedLoadState } from "./unified-load-state";
export { summarizeUnifiedLoadState } from "./unified-load-state";

export type { ValidationResult } from "./validation";
export { canTransitionStatus } from "./validation";

export {
  kickTasks,
  sendTasksToFirst,
  sendTasksToLast,
  moveTasksUp,
  moveTasksDown,
  dropkickTasks,
} from "./kick";

export {
  addTask,
  deleteTasks,
  updateTaskTitle,
  updateTaskDescription,
  changeTaskStatus,
  changeTaskPriority,
  changeTaskDueDate,
  addNote,
  deleteNote,
  updateNoteContent,
  changeNoteActionability,
  replaceTask,
} from "./task-operations";

export type { MoveResult } from "./move-operations";
export type { MoveSelectionOutcome, MoveSelectionInputs } from "./move-operations";
export { prepareMoveOperation, moveSelectedTasks } from "./move-operations";

export {
  parseKickDistances,
  isPreferencesDraftDirty,
  stagedPreferences,
} from "./preferences-draft";

export {
  composerDraftKey,
  editorDraftKey,
  reconcileDrafts,
} from "./note-drafts";

export type { LoadFailure, DocumentKind } from "./load-failure";
export { describeLoadFailure, fileNameWithoutExt } from "./load-failure";

export type { StagedPreferences } from "./preferences-draft";

export type {
  DeleteSelectedTasksInputs,
  DeleteSelectedTasksResult,
} from "./task-deletion";
export { deleteSelectedTasks } from "./task-deletion";
