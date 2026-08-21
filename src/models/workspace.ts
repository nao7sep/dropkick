// Workspace stored as a portable JSON file at any path.
// Tracks open tabs, recent files, and runtime tab state.

import { generateId } from "../utils/ids";

export interface WorkspaceDto {
  version: string;
  id: string; // stable identity, unique and generated once at creation
  name: string;
  openTabs: TabDto[];
  recentFiles: RecentFileDto[];
  activeTabIndex: number; // runtime-only, not persisted to workspace.json
}

export type PersistedWorkspaceDto = Omit<WorkspaceDto, "activeTabIndex">;

export interface TabDto {
  filePath: string;
  displayName: string;
  isUnifiedView: boolean;
}

export interface RecentFileDto {
  filePath: string;
  lastOpenedAtUtc: string; // ISO 8601
}

// Recognizes a parsed JSON document as a workspace file. This answers "is this
// one of ours?", which is a separate question from "are its fields well-formed?"
// — the loader still shape-checks the fields it finds. Without this gate any
// JSON object passes, takes every field from defaults, and the id write-back
// rewrites it as a workspace, so picking a neighbouring .json in the startup
// picker destroys it. The test is version plus at least one field only a
// workspace carries: that rejects a package.json or a task list while still
// letting mergeWithDefaults heal a document that predates a newly added field.
export function isWorkspaceDocument(
  data: unknown,
): data is Partial<PersistedWorkspaceDto> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }
  const candidate = data as Partial<PersistedWorkspaceDto>;
  return (
    typeof candidate.version === "string" &&
    (candidate.openTabs !== undefined || candidate.recentFiles !== undefined)
  );
}

export function createDefaultWorkspace(name: string): WorkspaceDto {
  return {
    version: "1.0.0",
    id: generateId(),
    name,
    openTabs: [],
    recentFiles: [],
    activeTabIndex: -1,
  };
}

export function createTab(filePath: string, displayName: string): TabDto {
  return {
    filePath,
    displayName,
    isUnifiedView: false,
  };
}

export function createUnifiedViewTab(): TabDto {
  return {
    filePath: "",
    displayName: "Unified View",
    isUnifiedView: true,
  };
}
