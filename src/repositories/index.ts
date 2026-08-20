export { log, toErrorFields, loadFailureFields, initLogging } from "./logging";
export type { LogFields } from "./logging";

export {
  readJsonFileResult,
  readJsonFileWithHash,
  writeJsonFile,
  quarantineFile,
  hashFile,
  fileExists,
  ensureDirectory,
  appPaths,
  withSerial,
  withSerialTwo,
  drainAllSerial,
} from "./file-system";
export type {
  JsonReadResult,
  JsonReadWithHashResult,
} from "./file-system";

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
  initializeAppState,
  flushAppState,
} from "./app-state-repository";

export { loadNoteDrafts, flushNoteDrafts } from "./note-draft-repository";
export type { LoadNoteDraftsResult } from "./note-draft-repository";

export {
  loadPreferences,
  flushPreferences,
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

export type { AppPaths } from "./file-system";
