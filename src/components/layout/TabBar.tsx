// Tab bar — displays open tabs with drag-to-reorder, close, and rename.
// The [+] button opens a menu to create/open task list files.

import { useState, useRef, useEffect } from "react";
import { Plus, X, Layout, FileText } from "lucide-react";
import { useWorkspaceStore } from "../../state/workspace-store";
import { useTaskListStore } from "../../state/task-list-store";
import {
  openJsonFileDialog,
  saveJsonFileDialog,
} from "../../repositories";

export function TabBar() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const activeTabIndex = workspace.activeTabIndex;
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const renameTab = useWorkspaceStore((s) => s.renameTab);
  const addTab = useWorkspaceStore((s) => s.addTab);
  const addUnifiedViewTab = useWorkspaceStore((s) => s.addUnifiedViewTab);
  const addRecentFile = useWorkspaceStore((s) => s.addRecentFile);
  const loadFile = useTaskListStore((s) => s.loadFile);
  const createFile = useTaskListStore((s) => s.createFile);
  const unloadFile = useTaskListStore((s) => s.unloadFile);

  const [showNewMenu, setShowNewMenu] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus rename input when editing starts.
  useEffect(() => {
    if (editingIndex !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingIndex]);

  // Close menu when clicking outside.
  useEffect(() => {
    if (!showNewMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowNewMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showNewMenu]);

  const handleNewTaskList = async () => {
    setShowNewMenu(false);
    try {
      const path = await saveJsonFileDialog("tasks.json");
      if (!path) return;
      const normalizedPath = path.endsWith(".json") ? path : `${path}.json`;
      await createFile(normalizedPath);
      const name = fileNameWithoutExt(normalizedPath);
      await addTab(normalizedPath, name);
      await addRecentFile(normalizedPath);
    } catch (e) {
      console.error("Failed to create task list:", e);
    }
  };

  const handleOpenExisting = async () => {
    setShowNewMenu(false);
    try {
      const path = await openJsonFileDialog();
      if (!path) return;
      const loaded = await loadFile(path);
      if (!loaded) return;
      const name = fileNameWithoutExt(path);
      await addTab(path, name);
      await addRecentFile(path);
    } catch (e) {
      console.error("Failed to open task list:", e);
    }
  };

  const handleOpenRecent = async (path: string) => {
    setShowNewMenu(false);
    try {
      const loaded = await loadFile(path);
      if (!loaded) return;
      const name = fileNameWithoutExt(path);
      await addTab(path, name);
      await addRecentFile(path);
    } catch (e) {
      console.error("Failed to open recent file:", e);
    }
  };

  const handleUnifiedView = async () => {
    setShowNewMenu(false);
    try {
      await addUnifiedViewTab();
    } catch (e) {
      console.error("Failed to open unified view:", e);
    }
  };

  const handleCloseTab = async (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    const tab = workspace.openTabs[index];
    if (tab && !tab.isUnifiedView) {
      unloadFile(tab.filePath);
    }
    await closeTab(index);
  };

  const handleDoubleClick = (index: number) => {
    const tab = workspace.openTabs[index];
    if (!tab || tab.isUnifiedView) return;
    setEditingIndex(index);
    setEditValue(tab.displayName);
  };

  const handleRenameSubmit = async () => {
    if (editingIndex !== null && editValue.trim()) {
      await renameTab(editingIndex, editValue.trim());
    }
    setEditingIndex(null);
  };

  const recentFiles = workspace.recentFiles.filter(
    (r) => !workspace.openTabs.some((t) => t.filePath === r.filePath),
  );

  return (
    <div className="flex h-10 items-center border-b border-gray-200 bg-white">
      {/* Tabs */}
      <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
        {workspace.openTabs.map((tab, index) => (
          <div
            key={tab.isUnifiedView ? "__unified__" : tab.filePath}
            onClick={() => setActiveTab(index)}
            onDoubleClick={() => handleDoubleClick(index)}
            className={`group flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-gray-200 px-3 py-2 text-sm transition-colors ${
              index === activeTabIndex
                ? "bg-blue-50 text-blue-700"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            {tab.isUnifiedView ? (
              <Layout size={14} className="shrink-0" />
            ) : (
              <FileText size={14} className="shrink-0" />
            )}

            {editingIndex === index ? (
              <input
                ref={editInputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleRenameSubmit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameSubmit();
                  if (e.key === "Escape") setEditingIndex(null);
                }}
                className="w-24 rounded border border-blue-300 px-1 text-sm outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="max-w-32 truncate">{tab.displayName}</span>
            )}

            <button
              onClick={(e) => handleCloseTab(e, index)}
              className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-gray-200 group-hover:opacity-100"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* New tab button */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setShowNewMenu(!showNewMenu)}
          className="flex h-10 w-10 items-center justify-center text-gray-500 transition-colors hover:bg-gray-100"
        >
          <Plus size={16} />
        </button>

        {showNewMenu && (
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
            <button
              onClick={handleNewTaskList}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              New task list...
            </button>
            <button
              onClick={handleOpenExisting}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              Open existing file...
            </button>
            <button
              onClick={handleUnifiedView}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              Unified view
            </button>

            {recentFiles.length > 0 && (
              <>
                <div className="my-1 border-t border-gray-100" />
                <div className="px-4 py-1 text-xs font-medium text-gray-400">
                  Recent
                </div>
                {recentFiles.slice(0, 10).map((r) => (
                  <button
                    key={r.filePath}
                    onClick={() => handleOpenRecent(r.filePath)}
                    className="w-full px-4 py-1.5 text-left text-sm text-gray-600 hover:bg-gray-50"
                  >
                    <span className="block truncate" title={r.filePath}>
                      {fileNameWithoutExt(r.filePath)}
                    </span>
                    <span className="block truncate text-xs text-gray-400">
                      {r.filePath}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function fileNameWithoutExt(path: string): string {
  const parts = path.split("/");
  const name = parts[parts.length - 1] ?? "tasks";
  return name.replace(/\.json$/, "");
}
