// Workspace stored as a portable JSON file at any path.
// Tracks open tabs, recent files, and active tab state.

export interface WorkspaceDto {
  version: string;
  name: string;
  openTabs: TabDto[];
  recentFiles: RecentFileDto[];
  activeTabIndex: number;
}

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
