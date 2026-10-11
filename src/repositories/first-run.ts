import { invoke } from "@tauri-apps/api/core";
import { createDefaultPreferences, createDefaultWorkspace, createEmptyTaskList, preferencesDocument } from "../models";
import { withFormatVersion } from "../models/store-format";
import { withSerial } from "./file-system";

export interface InitialDocuments {
  preferencesPath: string;
  workspacePath: string;
  taskListPath: string | null;
}

export interface InitialDocumentNames {
  preferences: string;
  workspace: string;
  taskList: string;
}

export function getSuggestedSetupDirectory(): Promise<string> {
  return invoke<string>("suggested_setup_directory");
}

export function createInitialDocuments(
  directory: string,
  includeTaskList: boolean,
  names: InitialDocumentNames,
): Promise<InitialDocuments> {
  // Claim before the first await, including directory creation and all three
  // publications. Quit's normal drain therefore owns the entire setup.
  return withSerial(directory, async () => {
    const { activeTabIndex: _activeTabIndex, ...workspace } = createDefaultWorkspace(names.workspace);
    return invoke<InitialDocuments>("create_initial_documents", {
      directory,
      preferences: withFormatVersion("preferences", preferencesDocument(createDefaultPreferences(names.preferences))),
      workspace: withFormatVersion("workspace", workspace),
      taskList: includeTaskList ? withFormatVersion("taskList", createEmptyTaskList()) : null,
      taskListName: names.taskList,
    });
  });
}
