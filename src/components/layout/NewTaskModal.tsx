// New Task modal — opened via the primary new-task shortcut.

import { useState, useRef, useMemo } from "react";
import type { TaskPriority } from "../../models";
import {
  hasPrimaryShortcutModifier,
  matchesShortcutKey,
  sanitizeSingleLine,
  todayInTimezone,
  tomorrowInTimezone,
} from "../../utils";
import { useWorkspaceStore } from "../../state/workspace-store";
import { useTaskListStore } from "../../state/task-list-store";
import { usePreferencesStore } from "../../state/preferences-store";
import { DatePicker } from "../shared/DatePicker";
import { AppModal } from "../shared/AppModal";
import { useComposing, isComposingKeyboardEvent } from "../../hooks/useComposing";
import { useAutoGrow } from "../../hooks/useAutoGrow";
import { showMessage, showUnsavedChangesConfirm } from "../../repositories";

interface NewTaskModalProps {
  currentFilePath: string;
  isUnifiedView: boolean;
  onClose: () => void;
}

export function NewTaskModal({
  currentFilePath,
  isUnifiedView,
  onClose,
}: NewTaskModalProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const addNewTask = useTaskListStore((s) => s.addNewTask);
  const timezone = usePreferencesStore((s) => s.preferences.timezone);

  const fileTabs = workspace.openTabs.filter((t) => !t.isUnifiedView);

  // In unified view, don't auto-select — require explicit choice.
  const defaultTarget =
    !isUnifiedView && currentFilePath ? currentFilePath : "";

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("Default");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [targetFile, setTargetFile] = useState(defaultTarget);
  // submittingRef is the synchronous guard against rapid double-clicks;
  // `submitting` (state) drives the disabled-button render. See MoveTasksModal
  // for the same pattern.
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [targetError, setTargetError] = useState(false);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const targetSelectRef = useRef<HTMLSelectElement>(null);
  const composing = useComposing();
  const autoGrowTitle = useAutoGrow(titleRef);
  const autoGrowDesc = useAutoGrow(descRef);

  const canCreate = targetFile !== "" && fileTabs.length > 0;

  const isDirty = useMemo(
    () =>
      title !== "" ||
      description !== "" ||
      priority !== "Default" ||
      dueDate !== null ||
      targetFile !== defaultTarget,
    [title, description, priority, dueDate, targetFile, defaultTarget],
  );

  const handleRequestClose = async () => {
    if (!isDirty) {
      onClose();
      return;
    }
    const discard = await showUnsavedChangesConfirm();
    if (discard) onClose();
  };

  const handleCreate = async () => {
    if (submittingRef.current) return;
    if (!canCreate) {
      if (fileTabs.length > 0 && targetFile === "") {
        setTargetError(true);
        targetSelectRef.current?.focus();
      }
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const result = await addNewTask(targetFile, {
        title: sanitizeSingleLine(title),
        description,
        priority,
        dueDate,
      });

      if (result.status === "success") {
        onClose();
      } else if (result.status === "error") {
        await showMessage("Create Task Failed", result.message);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || !hasPrimaryShortcutModifier(e)) return;

    // Primary modifier + Enter submits from anywhere in the modal.
    if (e.key === "Enter") {
      if (isComposingKeyboardEvent(composing.composingRef, e)) return;
      e.preventDefault();
      handleCreate();
      return;
    }

    if (matchesShortcutKey(e, "0")) {
      e.preventDefault();
      setPriority("Default");
      return;
    }

    if (matchesShortcutKey(e, "1")) {
      e.preventDefault();
      setPriority("Urgent");
      return;
    }

    if (matchesShortcutKey(e, "2")) {
      e.preventDefault();
      setPriority("Important");
      return;
    }

    if (matchesShortcutKey(e, "3")) {
      e.preventDefault();
      setPriority("Critical");
      return;
    }

    if (matchesShortcutKey(e, "t")) {
      e.preventDefault();
      setDueDate(todayInTimezone(timezone));
      return;
    }

    if (matchesShortcutKey(e, "y")) {
      e.preventDefault();
      setDueDate(tomorrowInTimezone(timezone));
      return;
    }

    if (matchesShortcutKey(e, "n")) {
      e.preventDefault();
      setDueDate(null);
    }
  };

  const fileLabel = (path: string) => {
    const parts = path.split(/[\\/]/);
    return (parts[parts.length - 1] ?? "").replace(/\.json$/, "");
  };

  return (
    <AppModal
      title="New Task"
      onClose={onClose}
      onRequestClose={handleRequestClose}
      maxWidth={448}
      bodyClassName="space-y-4 overflow-y-auto px-6 py-5"
      footer={
        <>
          <button
            onClick={handleRequestClose}
            className="rounded-md border border-border px-4 py-2 text-sm text-ink-soft hover:bg-background"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate || submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm text-ink-inverted hover:bg-primary-hover disabled:bg-background disabled:text-ink-muted"
          >
            Create
          </button>
        </>
      }
      contentProps={{
        onKeyDown: handleKeyDown,
        onOpenAutoFocus: (e) => {
          e.preventDefault();
          titleRef.current?.focus();
        },
      }}
    >
      {/* Target list */}
      {fileTabs.length > 0 && (
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">
            Add to list
          </label>
          <select
            ref={targetSelectRef}
            value={targetFile}
            onChange={(e) => {
              setTargetFile(e.target.value);
              setTargetError(false);
            }}
            className={`w-full rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring ${targetError ? "bg-danger-surface" : ""}`}
          >
            {!targetFile && (
              <option value="" disabled>
                Select a task list...
              </option>
            )}
            {fileTabs.map((tab) => (
              <option key={tab.filePath} value={tab.filePath}>
                {tab.displayName || fileLabel(tab.filePath)}
              </option>
            ))}
          </select>
        </div>
      )}

      {fileTabs.length === 0 && (
        <p className="text-xs text-danger">
          No task lists open. Open or create a task list first.
        </p>
      )}

      {/* Title */}
      <div>
        <label className="mb-1 block text-xs font-medium text-ink-muted">
          Title
        </label>
        <textarea
          ref={titleRef}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            autoGrowTitle();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (isComposingKeyboardEvent(composing.composingRef, e)) return;
              e.preventDefault();
              handleCreate();
            }
          }}
          {...composing.handlers}
          placeholder="Task title (optional)"
          rows={1}
          className="w-full resize-none rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
        />
      </div>

      {/* Description */}
      <div>
        <label className="mb-1 block text-xs font-medium text-ink-muted">
          Description
        </label>
        <textarea
          ref={descRef}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            autoGrowDesc();
          }}
          placeholder="Optional details..."
          rows={2}
          className="w-full resize-none rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
        />
      </div>

      {/* Priority and Due date — side by side */}
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-ink-muted">
            Priority
          </label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            className="w-full rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
          >
            <option value="Default">Default</option>
            <option value="Urgent">Urgent</option>
            <option value="Important">Important</option>
            <option value="Critical">Critical</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">
            Due date
          </label>
          <DatePicker value={dueDate} onChange={setDueDate} popoverPosition="top" />
        </div>
      </div>
    </AppModal>
  );
}
