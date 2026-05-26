// Reads and writes workspace files.

import type { PersistedWorkspaceDto, WorkspaceDto } from "../models";
import { createDefaultWorkspace } from "../models";
import { readJsonFileResult, writeJsonFile } from "./file-system";

export type LoadWorkspaceResult =
  | { status: "success"; workspace: WorkspaceDto }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

// Loads a workspace file. Missing files fall back to defaults; invalid files
// are reported so the user does not mistake a parse failure for an empty workspace.
// Merges with defaults so newly added fields (like id) are always present.
// activeTabIndex is runtime-only and is re-injected after parsing.
export async function loadWorkspace(path: string): Promise<LoadWorkspaceResult> {
  const result = await readJsonFileResult<
    Partial<PersistedWorkspaceDto> & { activeTabIndex?: number }
  >(path);
  if (result.status === "missing") {
    return {
      status: "success",
      workspace: createDefaultWorkspace("Default"),
    };
  }
  if (result.status !== "success") {
    return result;
  }

  const data = result.data;
  const defaults = createDefaultWorkspace(data.name ?? "Default");
  return {
    status: "success",
    workspace: {
      ...defaults,
      ...data,
      activeTabIndex: defaults.activeTabIndex,
    },
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
