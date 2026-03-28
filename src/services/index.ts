export type { GroupedTasks } from "./grouping";
export { groupTasksForList, groupTasksForUnifiedView } from "./grouping";

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
  updateTaskTitle,
  updateTaskDescription,
  changeTaskStatus,
  changeTaskPriority,
  changeTaskDueDate,
  addNote,
  updateNoteContent,
  changeNoteActionability,
  replaceTask,
} from "./task-operations";

export type { MoveResult } from "./move-operations";
export { prepareMoveOperation } from "./move-operations";
