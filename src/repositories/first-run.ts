import { invoke } from "@tauri-apps/api/core";
import { createDefaultWorkspace, createEmptyTaskList } from "../models";
import { withFormatVersion } from "../models/store-format";
import { withSerial } from "./file-system";

export interface InitialDocuments {
  workspacePath: string;
  taskListPath: string | null;
}

export interface InitialDocumentNames {
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
  // Claim before the first await, including directory creation and both
  // publications. Quit's normal drain therefore owns the entire setup.
  return withSerial(directory, async () => {
    const { activeTabIndex: _activeTabIndex, ...workspace } = createDefaultWorkspace(names.workspace);
    return invoke<InitialDocuments>("create_initial_documents", {
      directory,
      workspace: withFormatVersion("workspace", workspace),
      taskList: includeTaskList ? withFormatVersion("taskList", createEmptyTaskList()) : null,
      taskListName: names.taskList,
    });
  });
}
