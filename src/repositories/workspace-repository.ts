// Reads and writes workspace files.

import type { PersistedWorkspaceDto, WorkspaceDto } from "../models";
import { createDefaultWorkspace } from "../models";
import { readJsonFile, writeJsonFile } from "./file-system";

// Loads a workspace file. Returns a default empty workspace if the file is missing or invalid.
// Merges with defaults so newly added fields (like id) are always present.
// activeTabIndex is runtime-only and is re-injected after parsing.
export async function loadWorkspace(path: string): Promise<WorkspaceDto> {
  const data = await readJsonFile<
    Partial<PersistedWorkspaceDto> & { activeTabIndex?: number }
  >(path);
  if (data === null) {
    return createDefaultWorkspace("Default");
  }
  const defaults = createDefaultWorkspace(data.name ?? "Default");
  return {
    ...defaults,
    ...data,
    activeTabIndex: defaults.activeTabIndex,
  };
}

// Saves workspace to disk, omitting runtime-only fields.
export async function saveWorkspace(
  path: string,
  workspace: WorkspaceDto,
): Promise<void> {
  const { activeTabIndex: _activeTabIndex, ...persisted } = workspace;
  await writeJsonFile(path, persisted);
}

// Creates a new workspace file with defaults at the given path.
export async function createWorkspaceFile(
  path: string,
  name: string,
): Promise<WorkspaceDto> {
  const workspace = createDefaultWorkspace(name);
  const { activeTabIndex: _activeTabIndex, ...persisted } = workspace;
  await writeJsonFile(path, persisted);
  return workspace;
}
