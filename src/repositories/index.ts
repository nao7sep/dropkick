export {
  readJsonFile,
  readJsonFileResult,
  readJsonFileWithHash,
  writeJsonFile,
  hashFile,
  fileExists,
  ensureDirectory,
  withSerial,
  withSerialTwo,
} from "./file-system";
export type { JsonReadResult, JsonReadWithHashResult } from "./file-system";

export {
  openJsonFileDialog,
  saveJsonFileDialog,
  showMessage,
  showConfirm,
  showFileConflictDialog,
  showFileDeletedDialog,
  showUnsavedChangesConfirm,
} from "./dialogs";

export {
  initializeAppConfig,
  saveAppConfig,
  registerPreferencesPath,
  registerWorkspacePath,
  unregisterPreferencesPath,
  unregisterWorkspacePath,
} from "./app-config-repository";

export {
  loadPreferences,
  savePreferences,
  createPreferencesFile,
} from "./preferences-repository";
export type { LoadPreferencesResult } from "./preferences-repository";

export {
  loadWorkspace,
  flushWorkspace,
  createWorkspaceFile,
} from "./workspace-repository";
export type { LoadWorkspaceResult } from "./workspace-repository";

export type {
  LoadedTaskList,
  LoadTaskListResult,
  WriteResult,
  MoveResult,
  MoveInputs,
} from "./task-list-repository";
export {
  loadTaskList,
  createTaskListFile,
  flushTaskList,
  forceFlushTaskList,
  flushMove,
  forgetTaskList,
} from "./task-list-repository";
