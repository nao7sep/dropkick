// Move Tasks modal — choose a destination list for selected tasks.
// Opened via Cmd+M shortcut. Works in both specific list and unified view.

import { useRef, useState } from "react";
import type { Task } from "../../models";
import { useWorkspaceStore } from "../../state/workspace-store";
import { useTaskListStore } from "../../state/task-list-store";
import { showMessage } from "../../repositories";
import { AppModal } from "../shared/AppModal";
import { hasPrimaryShortcutModifier } from "../../utils";

interface MoveTasksModalProps {
  selectedTasks: Task[];
  sourceFilePath: string;
  isUnifiedView: boolean;
  nextActiveTaskId: string | null;
  onClose: () => void;
}

export function MoveTasksModal({
  selectedTasks,
  sourceFilePath,
  isUnifiedView,
  nextActiveTaskId,
  onClose,
}: MoveTasksModalProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const moveTasks = useTaskListStore((s) => s.moveTasks);
  const setSelection = useTaskListStore((s) => s.setSelection);

  const [moveTarget, setMoveTarget] = useState("");
  const [moving, setMoving] = useState(false);
  const [destError, setDestError] = useState(false);
  const destinationRef = useRef<HTMLSelectElement>(null);

  // In unified view, tasks may come from different files — collect all unique source files.
  const sourceFiles = isUnifiedView
    ? new Set(selectedTasks.map((t) => t.sourceFile))
    : new Set([sourceFilePath]);

  // Available destinations: open tabs that aren't unified view and aren't a source.
  const destinations = workspace.openTabs.filter(
    (t) => !t.isUnifiedView && !sourceFiles.has(t.filePath),
  );

  const handleMove = async () => {
    if (moving) return;
    if (!moveTarget) {
      setDestError(true);
      destinationRef.current?.focus();
      return;
    }
    setMoving(true);

    const taskIds = new Set(selectedTasks.map((t) => t.id));

    if (isUnifiedView) {
      // Group tasks by source file and move each group.
      const bySource = new Map<string, Set<string>>();
      for (const task of selectedTasks) {
        const ids = bySource.get(task.sourceFile) ?? new Set();
        ids.add(task.id);
        bySource.set(task.sourceFile, ids);
      }
      let movedAny = false;
      for (const [src, ids] of bySource) {
        const result = await moveTasks(src, moveTarget, ids);
        if (result.status === "error") {
          setSelection(taskIds);
          setMoving(false);
          const message = movedAny
            ? `Some selected tasks were moved before the operation stopped.\n\n${result.message}`
            : result.message;
          await showMessage("Move Failed", message);
          return;
        }
        movedAny = true;
      }
      // Re-select — tasks are still visible in unified view.
      setSelection(taskIds);
    } else {
      const result = await moveTasks(sourceFilePath, moveTarget, taskIds);
      if (result.status === "error") {
        setMoving(false);
        await showMessage("Move Failed", result.message);
        return;
      }
      setSelection(nextActiveTaskId ? new Set([nextActiveTaskId]) : new Set());
    }

    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (hasPrimaryShortcutModifier(e) && e.key === "Enter") {
      e.preventDefault();
      handleMove();
    }
  };

  return (
    <AppModal
      title={`Move ${selectedTasks.length} task${selectedTasks.length > 1 ? "s" : ""}`}
      onClose={onClose}
      maxWidth={384}
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleMove}
            disabled={!moveTarget || moving}
            className="rounded-md bg-sky-700 px-4 py-2 text-sm text-white hover:bg-sky-800 disabled:bg-gray-50 disabled:text-gray-500"
          >
            Move
          </button>
        </>
      }
      contentProps={{
        onKeyDown: handleKeyDown,
        onOpenAutoFocus: (e) => {
          if (destinations.length === 0) return;
          e.preventDefault();
          destinationRef.current?.focus();
        },
      }}
    >
      {/* Task list */}
      <div className="mb-4 max-h-32 space-y-1 overflow-y-auto text-sm text-gray-500">
        {selectedTasks.map((t) => (
          <div key={t.id} className="truncate">
            • {t.title || "Untitled"}
          </div>
        ))}
      </div>

      {destinations.length === 0 ? (
        <p className="text-sm text-gray-500">
          No other lists are open. Open another list tab first.
        </p>
      ) : (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Destination
          </label>
          <select
            ref={destinationRef}
            value={moveTarget}
            onChange={(e) => {
              setMoveTarget(e.target.value);
              setDestError(false);
            }}
            className={`w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 outline-none focus:border-sky-400 ${destError ? "bg-red-50" : ""}`}
          >
            <option value="">Select destination...</option>
            {destinations.map((t) => (
              <option key={t.filePath} value={t.filePath}>
                {t.displayName}
              </option>
            ))}
          </select>
        </div>
      )}
    </AppModal>
  );
}
