export type { AppConfigDto, AppConfigSetKey } from "./app-config";
export {
  appConfigDocument,
  createDefaultAppConfig,
  APP_CONFIG_SET_KEYS,
  isValidAppConfigSet,
  registerDocument,
  unregisterDocument,
} from "./app-config";

export type {
  AppStateDto,
} from "./app-state";
export { createDefaultAppState } from "./app-state";


export type {
  PreferencesDto,
  ThemePreference,
  PreferenceSetKey,
  PreferenceSets,
} from "./preferences";
export {
  changedPreferenceSets,
  createDefaultPreferences,
  PREFERENCE_SET_KEYS,
  isPreferencesDocument,
  isValidPreferenceSet,
  preferencesDocument,
  normalizeDueSoonDays,
  normalizeHandledTasksPageSize,
  normalizeKickDistances,
  normalizeThemePreference,
  DEFAULT_KICK_DISTANCES,
  DEFAULT_UI_FONT_STACK,
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

export type { StoreFormat, FormatVersionCheck, StoreRecovery } from "./store-format";
export { FORMAT_VERSIONS, checkFormatVersion, withFormatVersion } from "./store-format";
