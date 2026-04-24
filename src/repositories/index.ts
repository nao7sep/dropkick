export {
  readJsonFile,
  readJsonFileWithHash,
  writeJsonFile,
  hashFile,
  fileExists,
  ensureDirectory,
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

export {
  loadWorkspace,
  saveWorkspace,
  createWorkspaceFile,
} from "./workspace-repository";

export type { LoadedTaskList, WriteResult } from "./task-list-repository";
export {
  loadTaskList,
  createTaskListFile,
  writeTaskList,
  forceWriteTaskList,
  atomicMoveWrite,
} from "./task-list-repository";
