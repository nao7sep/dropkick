// Workspace stored as a portable JSON file at any path.
// Tracks open tabs, recent files, and runtime tab state.

import { generateId } from "../utils/ids";

export interface WorkspaceDto {
  version: string;
  id: string; // unique, generated once, used for backup subdirectory
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
