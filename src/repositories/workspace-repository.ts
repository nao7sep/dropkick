// Reads and writes workspace files.

import type { WorkspaceDto } from "../models";
import { createDefaultWorkspace } from "../models";
import { readJsonFile, writeJsonFile } from "./file-system";

// Loads a workspace file. Returns a default empty workspace if the file is missing or invalid.
// Merges with defaults so newly added fields (like id) are always present.
export async function loadWorkspace(path: string): Promise<WorkspaceDto> {
  const data = await readJsonFile<Partial<WorkspaceDto>>(path);
  if (data === null) {
    return createDefaultWorkspace("Default");
  }
  const defaults = createDefaultWorkspace(data.name ?? "Default");
  return { ...defaults, ...data };
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
