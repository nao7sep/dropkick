// Move Tasks modal — choose a destination list for selected tasks.
// Opened via Cmd+M shortcut. Works in both specific list and unified view.

import { useRef, useState } from "react";
import type { Task } from "../../models";
import { useWorkspaceStore } from "../../state/workspace-store";
import { useTaskListStore } from "../../state/task-list-store";
import { AppModal } from "../shared/AppModal";
import { SelectedTaskTitleList } from "../shared/SelectedTaskTitleList";
import { hasPrimaryShortcutModifier } from "../../utils";
import { moveSelectedTasks } from "../../services";

interface MoveTasksModalProps {
  selectedTasks: Task[];
  sourceFilePath: string;
  isUnifiedView: boolean;
  nextActiveTaskKey: string | null;
  onClose: () => void;
}

export function MoveTasksModal({
  selectedTasks,
  sourceFilePath,
  isUnifiedView,
  nextActiveTaskKey,
  onClose,
}: MoveTasksModalProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const moveTasks = useTaskListStore((s) => s.moveTasks);
  const setSelection = useTaskListStore((s) => s.setSelection);

  const [moveTarget, setMoveTarget] = useState("");
  // movingRef is the synchronous guard against rapid double-clicks — useState
  // doesn't update its closure value before the next click's handler fires,
  // so two clicks before re-render would both pass an `if (moving) return`
  // check. The ref reflects the latest value immediately. `moving` (state)
  // is kept only to drive the disabled-button render.
  const movingRef = useRef(false);
  const [moving, setMoving] = useState(false);
  const [destError, setDestError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
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
    if (movingRef.current) return;
    if (!moveTarget) {
      setDestError(true);
      destinationRef.current?.focus();
      return;
    }
    movingRef.current = true;
    setMoving(true);
    setActionError(null);

    const outcome = await moveSelectedTasks({
      selectedTasks,
      destination: moveTarget,
      isUnifiedView,
      sourceFilePath,
      nextActiveTaskKey,
      moveTasks,
    });
    setSelection(outcome.selection);
    if (outcome.status === "error") {
      movingRef.current = false;
      setMoving(false);
      setActionError(outcome.message!);
      return;
    }

    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return;
    // No IME composition guard here: this modal has no free-text field — the
    // only input is a <select> destination, which cannot host an IME
    // composition, so there is nothing for the guard to protect.
    if (hasPrimaryShortcutModifier(e) && e.key === "Enter") {
      e.preventDefault();
      handleMove();
    }
  };

  return (
    <AppModal
      title={`Move ${selectedTasks.length} task${selectedTasks.length > 1 ? "s" : ""}`}
      // Pure-selection modal per the modal conventions: the only draft is the
      // <select> destination, committed solely by the Move button. Closing
      // discards no persisted draft, so there is no dirty state — close routes
      // directly through onClose with no useDirtyClose/dirty prompt by design
      // (a dirty prompt here would be a forbidden fake prompt). onRequestClose
      // is intentionally unset so AppModal's fallback drives every close path.
      onClose={onClose}
      maxWidth={384}
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm text-ink-soft hover:bg-background"
          >
            Cancel
          </button>
          <button
            onClick={handleMove}
            disabled={!moveTarget || moving}
            className="rounded-md bg-primary-solid px-4 py-2 text-sm text-ink-inverted hover:bg-primary-solid-hover disabled:bg-background disabled:text-ink-muted"
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
      {actionError ? (
        <p role="alert" className="mb-4 text-sm text-danger">
          {actionError}
        </p>
      ) : null}

      <SelectedTaskTitleList
        tasks={selectedTasks}
        className="mb-4 max-h-32 overflow-y-auto"
      />

      {destinations.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No other lists are open. Open another list tab first.
        </p>
      ) : (
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">
            Destination
          </label>
          <select
            ref={destinationRef}
            aria-invalid={destError}
            aria-describedby={destError ? "move-tasks-destination-error" : undefined}
            value={moveTarget}
            onChange={(e) => {
              setMoveTarget(e.target.value);
              setDestError(false);
              setActionError(null);
            }}
            className={`w-full rounded-md border border-border px-3 py-1.5 text-sm text-ink-soft outline-none focus:border-primary-ring ${destError ? "bg-danger-surface" : ""}`}
          >
            <option value="">Select destination...</option>
            {destinations.map((t) => (
              <option key={t.filePath} value={t.filePath}>
                {t.displayName}
              </option>
            ))}
          </select>
          {destError ? (
            <p id="move-tasks-destination-error" role="alert" className="mt-1 text-xs text-danger">
              Select the task list that should receive these tasks.
            </p>
          ) : null}
        </div>
      )}
    </AppModal>
  );
}
