// Reads and writes workspace files.
//
// Saves are serialized per path. The store mutates synchronously and then
// awaits a flush; if several flushes queue against the same path, each runs in
// order and writes the latest store state at the moment its turn comes up. No
// hash check is needed — the workspace file is owned exclusively by Dropkick.

import type { WorkspaceDto } from "../models";
import { createDefaultWorkspace, isWorkspaceDocument } from "../models";
import {
  readJsonFileResult,
  writeJsonFile,
  withSerial,
} from "./file-system";

export type LoadWorkspaceResult =
  | { status: "success"; workspace: WorkspaceDto }
  | { status: "missing" }
  | { status: "invalid"; message: string }
  | { status: "newer"; formatVersion: number }
  | { status: "error"; message: string };

// Loads a workspace file. Missing and invalid files are reported explicitly so
// selected files do not silently become default workspaces. activeTabIndex is
// runtime-only and is set after parsing; unrecognized keys are left behind.
export async function loadWorkspace(path: string): Promise<LoadWorkspaceResult> {
  const result = await readJsonFileResult<unknown>(path, "workspace");
  if (result.status !== "success") return result;
  const data = result.data;
  if (!isWorkspaceDocument(data)) {
    return { status: "invalid", message: "not a workspace document" };
  }
  return {
    status: "success",
    workspace: {
      id: data.id,
      name: data.name,
      openTabs: data.openTabs,
      recentFiles: data.recentFiles,
      activeTabIndex: -1,
    },
  };
}

// Flushes the latest workspace state to disk. Calls are serialized per path,
// so overlapping flushes can never land out of order. `getWorkspace` is
// invoked inside the serial slot, so it sees the latest store state at the
// instant of the write.
export async function flushWorkspace(
  path: string,
  getWorkspace: () => WorkspaceDto,
): Promise<void> {
  await withSerial(path, async () => {
    const workspace = getWorkspace();
    const { activeTabIndex: _activeTabIndex, ...persisted } = workspace;
    await writeJsonFile(path, "workspace", persisted);
  });
}

// Creates a new workspace file with defaults at the given path.
export async function createWorkspaceFile(
  path: string,
  name: string,
): Promise<WorkspaceDto> {
  const workspace = createDefaultWorkspace(name);
  const { activeTabIndex: _activeTabIndex, ...persisted } = workspace;
  await writeJsonFile(path, "workspace", persisted);
  return workspace;
}
