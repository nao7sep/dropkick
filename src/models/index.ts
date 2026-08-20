export type {
  AppConfigDto,
} from "./app-config";
export { createDefaultAppConfig } from "./app-config";

export type { NoteDraftsDto } from "./note-drafts";
export { createDefaultNoteDrafts } from "./note-drafts";

export type {
  PreferencesDto,
} from "./preferences";
export {
  createDefaultPreferences,
  isPreferencesDocument,
  normalizeDueSoonDays,
  normalizeHandledTasksPageSize,
  normalizeKickDistances,
  DEFAULT_KICK_DISTANCES,
  DUE_SOON_DAYS_MIN,
  DUE_SOON_DAYS_MAX,
  DUE_SOON_DAYS_DEFAULT,
  HANDLED_TASKS_PAGE_SIZE_MIN,
  HANDLED_TASKS_PAGE_SIZE_MAX,
  HANDLED_TASKS_PAGE_SIZE_DEFAULT,
} from "./preferences";

export type {
  WorkspaceDto,
  PersistedWorkspaceDto,
  TabDto,
  RecentFileDto,
} from "./workspace";
export {
  createDefaultWorkspace,
  isWorkspaceDocument,
  createTab,
  createUnifiedViewTab,
} from "./workspace";

export type {
  TaskStatus,
  TaskPriority,
  NoteActionability,
  NoteDto,
  TaskDto,
  TaskListDto,
} from "./task-list";
export { createEmptyTaskList } from "./task-list";

export type {
  TaskGroup,
  Task,
} from "./domain";
export { TASK_GROUP_ORDER } from "./domain";
