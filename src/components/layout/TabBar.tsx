// Tab bar — displays open tabs with drag-to-reorder, close, and rename.
// The [+] button opens a menu to create/open task list files.
// The gear icon opens a menu with Settings, Keyboard Shortcuts, and About.

import { useState, useRef, useEffect } from "react";
import { Plus, X, Layout, FileText, Menu, Settings, Keyboard, Info, Minus } from "lucide-react";
import { sanitizeSingleLine, stepZoomIn, stepZoomOut, ZOOM_DEFAULT } from "../../utils";
import { useComposing, isComposingKeyboardEvent } from "../../hooks/useComposing";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useWorkspaceStore } from "../../state/workspace-store";
import { useTaskListStore } from "../../state/task-list-store";
import { usePreferencesStore } from "../../state/preferences-store";
import {
  openJsonFileDialog,
  saveJsonFileDialog,
} from "../../repositories";

type GearMenuItem = "settings" | "shortcuts" | "about";

interface TabBarProps {
  onGearMenuSelect: (item: GearMenuItem) => void;
}

export function TabBar({ onGearMenuSelect }: TabBarProps) {
  const preferences = usePreferencesStore((s) => s.preferences);
  const updatePrefs = usePreferencesStore((s) => s.update);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const activeTabIndex = workspace.activeTabIndex;
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const renameTab = useWorkspaceStore((s) => s.renameTab);
  const reorderTabs = useWorkspaceStore((s) => s.reorderTabs);
  const addTab = useWorkspaceStore((s) => s.addTab);
  const addUnifiedViewTab = useWorkspaceStore((s) => s.addUnifiedViewTab);
  const addRecentFile = useWorkspaceStore((s) => s.addRecentFile);
  const loadFile = useTaskListStore((s) => s.loadFile);
  const createFile = useTaskListStore((s) => s.createFile);

  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showGearMenu, setShowGearMenu] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const gearMenuRef = useRef<HTMLDivElement>(null);

  // Focus rename input when editing starts.
  useEffect(() => {
    if (editingIndex !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingIndex]);

  // Close menus when clicking outside.
  useEffect(() => {
    if (!showNewMenu && !showGearMenu) return;
    const handler = (e: MouseEvent) => {
      if (
        showNewMenu &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setShowNewMenu(false);
      }
      if (
        showGearMenu &&
        gearMenuRef.current &&
        !gearMenuRef.current.contains(e.target as Node)
      ) {
        setShowGearMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showNewMenu, showGearMenu]);

  // --- Drag-and-drop ---

  // Require 5px movement before starting a drag (so clicks still work).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Build stable sort IDs for each tab.
  const tabIds = workspace.openTabs.map((tab) =>
    tab.isUnifiedView ? "__unified__" : tab.filePath,
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const fromIndex = tabIds.indexOf(active.id as string);
    const toIndex = tabIds.indexOf(over.id as string);
    if (fromIndex === -1 || toIndex === -1) return;

    await reorderTabs(fromIndex, toIndex);
  };

  // --- Tab actions ---

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
    await closeTab(index);
  };

  const handleDoubleClick = (index: number) => {
    const tab = workspace.openTabs[index];
    if (!tab || tab.isUnifiedView) return;
    setEditingIndex(index);
    setEditValue(tab.displayName);
  };

  const handleRenameSubmit = async () => {
    if (editingIndex !== null) {
      const cleaned = sanitizeSingleLine(editValue);
      if (cleaned) {
        await renameTab(editingIndex, cleaned);
      }
    }
    setEditingIndex(null);
  };

  const recentFiles = workspace.recentFiles.filter(
    (r) => !workspace.openTabs.some((t) => t.filePath === r.filePath),
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={tabIds}
        strategy={horizontalListSortingStrategy}
      >
        <div className="flex min-h-10 flex-wrap items-center border-b border-gray-200 bg-white">
          {/* Tabs */}
          {workspace.openTabs.map((tab, index) => (
            <SortableTab
              key={tab.isUnifiedView ? "__unified__" : tab.filePath}
              id={tab.isUnifiedView ? "__unified__" : tab.filePath}
              tab={tab}
              index={index}
              isActive={index === activeTabIndex}
              isEditing={editingIndex === index}
              editValue={editValue}
              editInputRef={
                editingIndex === index ? editInputRef : undefined
              }
              onActivate={() => setActiveTab(index)}
              onDoubleClick={() => handleDoubleClick(index)}
              onClose={(e) => handleCloseTab(e, index)}
              onEditChange={setEditValue}
              onEditSubmit={handleRenameSubmit}
              onEditCancel={() => setEditingIndex(null)}
            />
          ))}

          {/* New tab button */}
          <div
            className="relative shrink-0"
            data-dropkick-interactive-layer={showNewMenu ? "" : undefined}
            ref={menuRef}
          >
            <button
              onClick={() => setShowNewMenu(!showNewMenu)}
              className="flex h-10 w-10 items-center justify-center text-sky-700 transition-colors hover:bg-sky-50"
            >
              <Plus size={16} />
            </button>

            {showNewMenu && (
              <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
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
                {!workspace.openTabs.some((t) => t.isUnifiedView) && (
                  <button
                    onClick={handleUnifiedView}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Unified view
                  </button>
                )}

                {recentFiles.length > 0 && (
                  <>
                    <div className="my-1 border-t border-gray-100" />
                    <div className="px-4 py-1 text-xs font-medium text-gray-500">
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
                        <span className="block truncate text-xs text-gray-500">
                          {r.filePath}
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Gear menu */}
          <div
            className="relative shrink-0"
            data-dropkick-interactive-layer={showGearMenu ? "" : undefined}
            ref={gearMenuRef}
          >
            <button
              onClick={() => setShowGearMenu(!showGearMenu)}
              className="flex h-10 w-10 items-center justify-center text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
              title="Menu"
            >
              <Menu size={15} />
            </button>

            {showGearMenu && (
              <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                <button
                  onClick={() => {
                    setShowGearMenu(false);
                    onGearMenuSelect("settings");
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Settings size={14} className="text-gray-500" />
                  Settings
                </button>
                <button
                  onClick={() => {
                    setShowGearMenu(false);
                    onGearMenuSelect("shortcuts");
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Keyboard size={14} className="text-gray-500" />
                  Keyboard Shortcuts
                </button>
                {/* Zoom controls — clicking +/− stays in the menu */}
                <div className="my-1 border-t border-gray-100" />
                <div className="flex items-center justify-center gap-3 px-3 py-1.5">
                  <span className="text-sm text-gray-600">Zoom</span>
                  <div className="flex items-center overflow-hidden rounded border border-gray-200">
                    <button
                      onClick={() => {
                        const next = stepZoomOut(preferences.zoomLevel);
                        if (next !== preferences.zoomLevel) updatePrefs({ zoomLevel: next });
                      }}
                      disabled={stepZoomOut(preferences.zoomLevel) === preferences.zoomLevel}
                      className="flex h-6 w-6 items-center justify-center bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-30"
                      title="Zoom out"
                    >
                      <Minus size={12} />
                    </button>
                    <span className="w-10 border-x border-gray-200 bg-white text-center text-xs tabular-nums text-gray-700 leading-6">
                      {Math.round(preferences.zoomLevel * 100)}%
                    </span>
                    <button
                      onClick={() => {
                        const next = stepZoomIn(preferences.zoomLevel);
                        if (next !== preferences.zoomLevel) updatePrefs({ zoomLevel: next });
                      }}
                      disabled={stepZoomIn(preferences.zoomLevel) === preferences.zoomLevel}
                      className="flex h-6 w-6 items-center justify-center bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-30"
                      title="Zoom in"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>
                {preferences.zoomLevel !== ZOOM_DEFAULT && (
                  <button
                    onClick={() => updatePrefs({ zoomLevel: ZOOM_DEFAULT })}
                    className="w-full pb-1.5 text-center text-xs text-sky-600 hover:text-sky-800"
                  >
                    Reset to 100%
                  </button>
                )}
                <div className="my-1 border-t border-gray-100" />
                <button
                  onClick={() => {
                    setShowGearMenu(false);
                    onGearMenuSelect("about");
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Info size={14} className="text-gray-500" />
                  About Dropkick
                </button>
              </div>
            )}
          </div>
        </div>
      </SortableContext>
    </DndContext>
  );
}

// --- Sortable tab item ---

interface SortableTabProps {
  id: string;
  tab: { isUnifiedView: boolean; displayName: string; filePath: string };
  index: number;
  isActive: boolean;
  isEditing: boolean;
  editValue: string;
  editInputRef?: React.RefObject<HTMLInputElement | null>;
  onActivate: () => void;
  onDoubleClick: () => void;
  onClose: (e: React.MouseEvent) => void;
  onEditChange: (value: string) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
}

function SortableTab({
  id,
  tab,
  isActive,
  isEditing,
  editValue,
  editInputRef,
  onActivate,
  onDoubleClick,
  onClose,
  onEditChange,
  onEditSubmit,
  onEditCancel,
}: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const composing = useComposing();

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onActivate}
      onDoubleClick={onDoubleClick}
      className={`group flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-gray-200 px-3 py-2 text-sm transition-colors ${
        isActive
          ? "bg-sky-50 text-sky-800"
          : "text-gray-700 hover:bg-gray-50"
      }`}
    >
      {tab.isUnifiedView ? (
        <Layout size={14} className="shrink-0" />
      ) : (
        <FileText size={14} className="shrink-0" />
      )}

      {isEditing ? (
        <input
          ref={editInputRef}
          value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onEditSubmit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (isComposingKeyboardEvent(composing.composingRef, e)) return;
              onEditSubmit();
            }
            if (e.key === "Escape") onEditCancel();
          }}
          {...composing.handlers}
          className="w-24 rounded border border-sky-400 px-1 text-sm outline-none"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="max-w-32 truncate">{tab.displayName}</span>
      )}

      <button
        onClick={onClose}
        className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-gray-200 group-hover:opacity-100"
      >
        <X size={12} />
      </button>
    </div>
  );
}

function fileNameWithoutExt(path: string): string {
  const parts = path.split(/[\\/]/);
  const name = parts[parts.length - 1] ?? "tasks";
  return name.replace(/\.json$/, "");
}
