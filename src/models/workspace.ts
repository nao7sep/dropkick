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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTab(value: unknown): value is TabDto {
  return isRecord(value)
    && typeof value.filePath === "string"
    && typeof value.displayName === "string"
    && typeof value.isUnifiedView === "boolean";
}

function isRecentFile(value: unknown): value is RecentFileDto {
  return isRecord(value)
    && typeof value.filePath === "string"
    && typeof value.lastOpenedAtUtc === "string";
}

// Recognizes a parsed JSON document as a workspace file with every field this
// build writes, down to each tab and recent file. Anything else — a
// package.json, a task list, a document missing a field — is not a workspace,
// so the startup picker reports it rather than loading it and later writing a
// workspace over it.
export function isWorkspaceDocument(data: unknown): data is PersistedWorkspaceDto {
  if (!isRecord(data)) return false;
  return typeof data.id === "string" && data.id !== ""
    && typeof data.name === "string"
    && Array.isArray(data.openTabs) && data.openTabs.every(isTab)
    && Array.isArray(data.recentFiles) && data.recentFiles.every(isRecentFile);
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
