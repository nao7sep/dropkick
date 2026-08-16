// Reads and writes workspace files.
//
// Saves are serialized per path. The store mutates synchronously and then
// awaits a flush; if several flushes queue against the same path, each runs in
// order and writes the latest store state at the moment its turn comes up. No
// hash check is needed — the workspace file is owned exclusively by Dropkick.

import type { PersistedWorkspaceDto, WorkspaceDto } from "../models";
import { createDefaultWorkspace } from "../models";
import {
  readJsonFileResult,
  writeJsonFile,
  withSerial,
} from "./file-system";
import { mergeWithDefaults } from "../utils/merge-defaults";

export type LoadWorkspaceResult =
  | { status: "success"; workspace: WorkspaceDto }
  | { status: "missing" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

// Loads a workspace file. Missing and invalid files are reported explicitly so
// selected files do not silently become default workspaces.
// Merges with defaults so newly added fields (like id) are always present, and
// drops stored keys no longer part of the shape so a retired field is never
// re-emitted on the next save. Required list fields are coerced to arrays so a
// corrupted file cannot crash startup, and activeTabIndex is runtime-only and is
// re-injected after parsing.
export async function loadWorkspace(path: string): Promise<LoadWorkspaceResult> {
  const result = await readJsonFileResult<
    Partial<PersistedWorkspaceDto> & { activeTabIndex?: number }
  >(path);
  if (result.status === "missing") {
    return { status: "missing" };
  }
  if (result.status !== "success") {
    return result;
  }

  const data = result.data;
  // A present-but-wrong-shape field is corruption, the same branch as
  // unparseable JSON: coercing it to [] and letting the next flush write the
  // emptied list back would destroy the user's tabs on a file that never
  // looked corrupt (storage-path conventions). An absent field still takes
  // its default below; the failing file is reported in place like any other
  // unloadable document, and the rest of the app keeps working.
  if (data.openTabs !== undefined && !Array.isArray(data.openTabs)) {
    return { status: "invalid", message: "openTabs is not an array" };
  }
  if (data.recentFiles !== undefined && !Array.isArray(data.recentFiles)) {
    return { status: "invalid", message: "recentFiles is not an array" };
  }
  const defaults = createDefaultWorkspace(data.name ?? "Default");
  const merged = mergeWithDefaults(defaults, data);
  const workspace: WorkspaceDto = {
    ...merged,
    openTabs: data.openTabs ?? defaults.openTabs,
    recentFiles: data.recentFiles ?? defaults.recentFiles,
    activeTabIndex: defaults.activeTabIndex,
  };
  // Materialize a missing stable id by persisting it once, so this workspace's
  // identity does not change between launches — without a write-back
  // mergeWithDefaults mints a fresh one on every load. Best-effort: a failed
  // write just defers materialization to the next load.
  if (!data.id) {
    const { activeTabIndex: _activeTabIndex, ...persisted } = workspace;
    try {
      await writeJsonFile(path, persisted);
    } catch {
      // Non-fatal — the id persists on the next successful save.
    }
  }
  return { status: "success", workspace };
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
    await writeJsonFile(path, persisted);
  });
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
