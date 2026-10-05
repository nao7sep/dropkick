// Workspace stored as a portable JSON file at any path.
// Tracks open tabs, recent files, and runtime tab state.

import { generateId } from "../utils/ids";

export interface WorkspaceDto {
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

// Recognizes a parsed JSON document as a workspace file with every field this
// build writes. Anything else — a package.json, a task list, a document missing
// a field — is not a workspace, so the startup picker reports it rather than
// loading it and later writing a workspace over it.
export function isWorkspaceDocument(data: unknown): data is PersistedWorkspaceDto {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }
  const candidate = data as Record<string, unknown>;
  return typeof candidate.id === "string" && candidate.id !== ""
    && typeof candidate.name === "string"
    && Array.isArray(candidate.openTabs)
    && Array.isArray(candidate.recentFiles);
}

export function createDefaultWorkspace(name: string): WorkspaceDto {
  return {
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
