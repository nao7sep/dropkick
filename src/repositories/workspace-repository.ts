// Reads and writes workspace files.

import type { WorkspaceDto } from "../models";
import { createDefaultWorkspace } from "../models";
import { readJsonFile, writeJsonFile } from "./file-system";

// Loads a workspace file. Returns a default empty workspace if the file is missing or invalid.
export async function loadWorkspace(path: string): Promise<WorkspaceDto> {
  const data = await readJsonFile<WorkspaceDto>(path);
  if (data === null) {
    return createDefaultWorkspace("Default");
  }
  return data;
}

// Saves workspace to disk.
export async function saveWorkspace(
  path: string,
  workspace: WorkspaceDto,
): Promise<void> {
  await writeJsonFile(path, workspace);
}

// Creates a new workspace file with defaults at the given path.
export async function createWorkspaceFile(
  path: string,
  name: string,
): Promise<WorkspaceDto> {
  const workspace = createDefaultWorkspace(name);
  await writeJsonFile(path, workspace);
  return workspace;
}
