// Single task detail — shown in right pane when exactly 1 task is selected.
// All fields are editable inline. Notes are listed newest first.

import { useState, useRef, useEffect } from "react";
import {
  AlertCircle,
  CheckCircle,
  Info,
  Trash2,
  X,
} from "lucide-react";
import type { Task, TaskStatus, TaskPriority, NoteDto, NoteActionability } from "../../models";
import type { ActionResult } from "../../state";
import { useTaskListStore } from "../../state/task-list-store";
import { usePreferencesStore } from "../../state/preferences-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { showConfirm, showMessage } from "../../repositories";
import {
  formatTimestamp,
  formatDueDate,
  sanitizeSingleLine,
  hasPrimaryShortcutModifier,
  primaryModifierLabel,
  taskKey,
  taskSelectionKey,
} from "../../utils";
import { DatePicker } from "../shared/DatePicker";
import { useComposing, isComposingKeyboardEvent } from "../../hooks/useComposing";
import { useAutoGrow } from "../../hooks/useAutoGrow";

interface TaskDetailProps {
  task: Task;
  filePath: string;
  isUnifiedView: boolean;
  nextActiveTaskKey: string | null;
  focusNewNoteSignal: number;
}

export function TaskDetail({
  task,
  filePath,
  isUnifiedView,
  nextActiveTaskKey,
  focusNewNoteSignal,
}: TaskDetailProps) {
  const preferences = usePreferencesStore((s) => s.preferences);
  const updateTitle = useTaskListStore((s) => s.updateTitle);
  const updateDescription = useTaskListStore((s) => s.updateDescription);
  const setStatusAction = useTaskListStore((s) => s.setStatus);
  const setPriority = useTaskListStore((s) => s.setPriority);
  const setDueDate = useTaskListStore((s) => s.setDueDate);
  const addNewNote = useTaskListStore((s) => s.addNewNote);
  const kickDistances = preferences.kickDistances;
  const kick = useTaskListStore((s) => s.kick);
  const sendToFirst = useTaskListStore((s) => s.sendToFirst);
  const sendToLast = useTaskListStore((s) => s.sendToLast);
  const dropkick = useTaskListStore((s) => s.dropkick);
  const removeTask = useTaskListStore((s) => s.removeTask);
  const moveTasks = useTaskListStore((s) => s.moveTasks);
  const setSelection = useTaskListStore((s) => s.setSelection);
  const workspace = useWorkspaceStore((s) => s.workspace);

  const [titleDraft, setTitleDraft] = useState(task.title);
  const [descDraft, setDescDraft] = useState(task.description);
  const [newNoteContent, setNewNoteContent] = useState("");
  const [moveTarget, setMoveTarget] = useState("");

  // Available move destinations (other open task list tabs).
  const moveDestinations = workspace.openTabs.filter(
    (t) => !t.isUnifiedView && t.filePath !== filePath,
  );

  // Sync drafts when task changes (different task selected).
  const currentTaskKey = taskSelectionKey(task);
  const [lastTaskKey, setLastTaskKey] = useState(currentTaskKey);
  if (currentTaskKey !== lastTaskKey) {
    setLastTaskKey(currentTaskKey);
    setTitleDraft(task.title);
    setDescDraft(task.description);
    setNewNoteContent("");
  }

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const newNoteRef = useRef<HTMLTextAreaElement>(null);
  const lastFocusNewNoteSignalRef = useRef(focusNewNoteSignal);
  const titleComposing = useComposing();
  const noteComposing = useComposing();
  const autoGrowTitle = useAutoGrow(titleRef);
  const autoGrowDesc = useAutoGrow(descRef);
  const autoGrowNewNote = useAutoGrow(newNoteRef);

  const showWriteFailure = async (title: string, result: ActionResult) => {
    if (result.status === "error") {
      await showMessage(title, result.message);
      return true;
    }
    return false;
  };

  // Sync drafts when the same task is updated externally (e.g. renamed in the left pane).
  // Skip if the field is focused — the user is actively editing.
  useEffect(() => {
    if (document.activeElement !== titleRef.current) {
      setTitleDraft(task.title);
    }
  }, [task.title]);

  useEffect(() => {
    if (document.activeElement !== descRef.current) {
      setDescDraft(task.description);
    }
  }, [task.description]);

  // Re-measure after external sync or content change.
  useEffect(() => autoGrowTitle(), [titleDraft, autoGrowTitle]);
  useEffect(() => autoGrowDesc(), [descDraft, autoGrowDesc]);
  useEffect(() => autoGrowNewNote(), [newNoteContent, autoGrowNewNote]);
  useEffect(() => {
    if (focusNewNoteSignal === lastFocusNewNoteSignalRef.current) return;
    lastFocusNewNoteSignalRef.current = focusNewNoteSignal;
    if (focusNewNoteSignal === 0) return;

    requestAnimationFrame(() => {
      const textarea = newNoteRef.current;
      if (!textarea) return;

      textarea.focus();
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
      autoGrowNewNote();
    });
  }, [focusNewNoteSignal, autoGrowNewNote]);

  const handleTitleBlur = async () => {
    const cleaned = sanitizeSingleLine(titleDraft);
    if (!cleaned) {
      // Revert — don't allow empty titles.
      setTitleDraft(task.title);
      return;
    }
    if (cleaned !== task.title) {
      const result = await updateTitle(filePath, task.id, cleaned);
      if (await showWriteFailure("Task Update Failed", result)) {
        setTitleDraft(task.title);
        return;
      }
    }
    setTitleDraft(cleaned);
  };

  const handleDescBlur = async () => {
    if (descDraft !== task.description) {
      const result = await updateDescription(filePath, task.id, descDraft);
      if (await showWriteFailure("Task Update Failed", result)) {
        setDescDraft(task.description);
      }
    }
  };

  const handleStatusChange = async (status: TaskStatus) => {
    const result = await setStatusAction(filePath, task.id, status);
    if (result.status === "validation") {
      await showMessage("Task Update Failed", result.reason);
      return;
    }
    if (result.status === "error") {
      await showMessage("Task Update Failed", result.message);
      return;
    }

    setSelection(nextActiveTaskKey ? new Set([nextActiveTaskKey]) : new Set());
  };

  const handlePriorityChange = async (priority: TaskPriority) => {
    const result = await setPriority(filePath, task.id, priority);
    await showWriteFailure("Task Update Failed", result);
  };

  const handleDueDateChange = async (value: string) => {
    const result = await setDueDate(filePath, task.id, value || null);
    await showWriteFailure("Task Update Failed", result);
  };

  const handleDeleteTask = async () => {
    const confirmed = await showConfirm(
      "Delete Task",
      `Permanently delete "${task.title || "Untitled"}"? This cannot be undone.`,
    );
    if (confirmed) {
      const result = await removeTask(filePath, task.id);
      if (result.status === "error") {
        await showMessage("Delete Failed", result.message);
        return;
      }
      setSelection(nextActiveTaskKey ? new Set([nextActiveTaskKey]) : new Set());
    }
  };

  const handleAddNote = async (
    actionability: NoteActionability = "Informational",
  ) => {
    if (!newNoteContent.trim()) return;
    const result = await addNewNote(
      filePath,
      task.id,
      newNoteContent,
      actionability,
    );
    if (await showWriteFailure("Note Update Failed", result)) return;
    setNewNoteContent("");
  };

  const handleMoveTask = async () => {
    if (!moveTarget) return;
    const ids = new Set([task.id]);
    const result = await moveTasks(filePath, moveTarget, ids);
    if (result.status === "error") {
      await showMessage("Move Failed", result.message);
      return;
    }
    if (isUnifiedView) {
      setSelection(new Set([taskKey(moveTarget, task.id)]));
    } else {
      setSelection(nextActiveTaskKey ? new Set([nextActiveTaskKey]) : new Set());
    }
    setMoveTarget("");
  };

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto px-4 pt-4">
      {/* Title */}
      <textarea
        ref={titleRef}
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={handleTitleBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (isComposingKeyboardEvent(titleComposing.composingRef, e)) return;
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        {...titleComposing.handlers}
        placeholder="Task title..."
        rows={1}
        className="mb-4 w-full shrink-0 resize-none text-lg font-semibold text-ink-strong outline-none placeholder:text-ink-muted"
      />

      {/* Status, Priority, Due Date row */}
      <div className="mb-4 flex flex-wrap gap-3">
        {/* Status */}
        <div>
          <label className="mb-1 block text-xs text-ink-muted">Status</label>
          <select
            value={task.status}
            onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
            className="rounded-md border border-border px-2 py-1 text-sm text-ink"
          >
            <option value="Pending">Pending</option>
            <option value="Completed" disabled={!task.canComplete}>
              Completed {!task.canComplete ? "(actionable notes)" : ""}
            </option>
            <option value="Dismissed">Dismissed</option>
          </select>
        </div>

        {/* Priority */}
        <div>
          <label className="mb-1 block text-xs text-ink-muted">Priority</label>
          <select
            value={task.priority}
            onChange={(e) => handlePriorityChange(e.target.value as TaskPriority)}
            className={`rounded-md border px-2 py-1 text-sm ${prioritySelectStyle(task.priority)}`}
          >
            <option value="Critical">Critical</option>
            <option value="Important">Important</option>
            <option value="Urgent">Urgent</option>
            <option value="Default">Default</option>
          </select>
        </div>

        {/* Due Date */}
        <div>
          <label className="mb-1 block text-xs text-ink-muted">Due</label>
          <DatePicker
            value={task.dueDate}
            onChange={(v) => handleDueDateChange(v ?? "")}
            isOverdue={task.isOverdue}
          />
        </div>
      </div>

      {/* Reorder buttons */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!isUnifiedView && (
          <>
            <button
              onClick={async () => {
                const result = await sendToFirst(filePath);
                await showWriteFailure("Task Reorder Failed", result);
              }}
              className="rounded border border-border px-2 py-1 text-xs text-ink-soft hover:bg-background"
            >
              Tackle
            </button>
            {kickDistances.map((d) => (
              <button
                key={d}
                onClick={async () => {
                  const result = await kick(filePath, d);
                  await showWriteFailure("Task Reorder Failed", result);
                }}
                className="rounded border border-border px-2 py-1 text-xs text-ink-soft hover:bg-background"
              >
                +{d}
              </button>
            ))}
            <button
              onClick={async () => {
                const result = await sendToLast(filePath);
                await showWriteFailure("Task Reorder Failed", result);
              }}
              className="rounded border border-border px-2 py-1 text-xs text-ink-soft hover:bg-background"
            >
              Kick
            </button>
            <button
              onClick={async () => {
                const result = await dropkick(filePath);
                await showWriteFailure("Task Reorder Failed", result);
              }}
              className="rounded border border-danger-border px-2 py-1 text-xs text-danger hover:bg-danger-surface"
            >
              Dropkick
            </button>
            <span className="mx-1 text-border">|</span>
          </>
        )}
        <button
          onClick={handleDeleteTask}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-ink-soft hover:border-danger-border hover:text-danger"
        >
          <Trash2 size={12} />
          Delete
        </button>
      </div>

      {/* Move to another list */}
      {moveDestinations.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <label className="text-xs text-ink-muted">Move to</label>
          <select
            value={moveTarget}
            onChange={(e) => setMoveTarget(e.target.value)}
            className="flex-1 rounded-md border border-border px-2 py-1 text-sm text-ink-soft"
          >
            <option value="">Select destination...</option>
            {moveDestinations.map((t) => (
              <option key={t.filePath} value={t.filePath}>
                {t.displayName}
              </option>
            ))}
          </select>
          <button
            onClick={handleMoveTask}
            disabled={!moveTarget}
            className="rounded-md bg-primary-solid px-3 py-1 text-xs text-ink-inverted hover:bg-primary-solid-hover disabled:bg-background disabled:text-ink-muted"
          >
            Move
          </button>
        </div>
      )}

      {/* Description */}
      <div className="mb-4">
        <label className="mb-1 block text-xs text-ink-muted">Description</label>
        <textarea
          ref={descRef}
          value={descDraft}
          onChange={(e) => {
            setDescDraft(e.target.value);
            autoGrowDesc();
          }}
          onBlur={handleDescBlur}
          rows={2}
          placeholder="Add a description..."
          className="w-full resize-none rounded-md border border-border p-2 text-sm text-ink outline-none focus:border-primary-ring"
        />
      </div>

      {/* Timestamps */}
      <div className="mb-4 space-y-0.5 text-xs text-ink-muted">
        <div>
          Created:{" "}
          {formatTimestamp(
            task.createdAtUtc,
            preferences.dateFormat,
            preferences.timeFormat,
            preferences.timezone,
          )}
        </div>
        <div>
          Updated:{" "}
          {formatTimestamp(
            task.updatedAtUtc,
            preferences.dateFormat,
            preferences.timeFormat,
            preferences.timezone,
          )}
        </div>
        {task.completedAtUtc && (
          <div>
            Handled:{" "}
            {formatTimestamp(
              task.completedAtUtc,
              preferences.dateFormat,
              preferences.timeFormat,
              preferences.timezone,
            )}
          </div>
        )}
        {task.dueDate && (
          <div>
            Due: {formatDueDate(task.dueDate, preferences.dateFormat)}
          </div>
        )}
      </div>

      {/* Notes section */}
      <div className="border-t border-border pt-4">
        <h4 className="mb-3 text-sm font-medium text-ink-soft">Notes</h4>

        {/* Add note */}
        <div className="mb-3">
          <textarea
            ref={newNoteRef}
            value={newNoteContent}
            onChange={(e) => {
              setNewNoteContent(e.target.value);
              autoGrowNewNote();
            }}
            onKeyDown={(e) => {
              if (hasPrimaryShortcutModifier(e) && e.key === "Enter") {
                if (isComposingKeyboardEvent(noteComposing.composingRef, e)) return;
                e.preventDefault();
                handleAddNote(e.shiftKey ? "Actionable" : "Informational");
              }
            }}
            {...noteComposing.handlers}
            placeholder={`Add a note... (${primaryModifierLabel}+Enter to save, ${primaryModifierLabel}+Shift+Enter actionable)`}
            rows={2}
            className="w-full resize-none rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
          />
          <div className="mt-1 flex justify-end">
            <button
              onClick={() => handleAddNote()}
              disabled={!newNoteContent.trim()}
              className="rounded-md bg-primary-solid px-3 py-1 text-xs text-ink-inverted hover:bg-primary-solid-hover disabled:bg-background disabled:text-ink-muted"
            >
              Add Note
            </button>
          </div>
        </div>

        {/* Notes list */}
        {task.notes.length === 0 ? (
          <div className="py-4 text-center text-sm text-ink-muted">
            No notes yet
          </div>
        ) : (
          <div className="space-y-2">
            {task.notes.map((note) => (
              <NoteItem
                key={note.id}
                note={note}
                taskId={task.id}
                filePath={filePath}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom spacer — prevents margin collapse at the scroll boundary */}
      <div className="shrink-0 pb-4" />
    </div>
  );
}

function NoteItem({
  note,
  taskId,
  filePath,
}: {
  note: NoteDto;
  taskId: string;
  filePath: string;
}) {
  const preferences = usePreferencesStore((s) => s.preferences);
  const updateNote = useTaskListStore((s) => s.updateNote);
  const removeNote = useTaskListStore((s) => s.removeNote);
  const setActionability = useTaskListStore((s) => s.setNoteActionability);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const composing = useComposing();
  const editRef = useRef<HTMLTextAreaElement>(null);
  const autoGrowEdit = useAutoGrow(editRef);

  // Re-measure when draft changes or when entering edit mode.
  useEffect(() => {
    if (editing) autoGrowEdit();
  }, [draft, editing, autoGrowEdit]);

  const handleSave = async () => {
    if (!draft.trim()) {
      // Revert — don't allow empty notes.
      setDraft(note.content);
      setEditing(false);
      return;
    }
    if (draft !== note.content) {
      const result = await updateNote(filePath, taskId, note.id, draft);
      if (result.status === "error") {
        await showMessage("Note Update Failed", result.message);
        setDraft(note.content);
        return;
      }
    }
    setEditing(false);
  };

  const handleDeleteNote = async () => {
    const confirmed = await showConfirm(
      "Delete Note",
      "Permanently delete this note?",
    );
    if (confirmed) {
      const result = await removeNote(filePath, taskId, note.id);
      if (result.status === "error") {
        await showMessage("Note Update Failed", result.message);
      }
    }
  };

  const handleActionabilityChange = async (actionability: NoteActionability) => {
    const result = await setActionability(filePath, taskId, note.id, actionability);
    if (result.status === "error") {
      await showMessage("Note Update Failed", result.message);
    }
  };

  const borderColor =
    note.actionability === "Actionable"
      ? "border-attention-border bg-attention-surface"
      : note.actionability === "Resolved"
        ? "border-success-border bg-success-surface/50"
        : "border-border";

  const icon =
    note.actionability === "Actionable" ? (
      <AlertCircle size={14} className="text-attention" />
    ) : note.actionability === "Resolved" ? (
      <CheckCircle size={14} className="text-success" />
    ) : (
      <Info size={14} className="text-ink-muted" />
    );

  return (
    <div className={`rounded-md border-l-4 border ${borderColor} p-3`}>
      <div className="mb-1 flex items-center gap-2">
        {icon}
        <select
          value={note.actionability}
          onChange={(e) =>
            handleActionabilityChange(e.target.value as NoteActionability)
          }
          className="rounded border border-border px-1 py-0.5 text-xs text-ink"
        >
          <option value="Informational">Informational</option>
          <option value="Actionable">Actionable</option>
          <option value="Resolved">Resolved</option>
        </select>

        <span className="ml-auto text-xs text-ink-muted">
          {formatTimestamp(
            note.createdAtUtc,
            preferences.dateFormat,
            preferences.timeFormat,
            preferences.timezone,
          )}
        </span>
        <button
          onClick={handleDeleteNote}
          className="rounded p-0.5 text-ink-muted hover:text-danger"
          title="Delete note"
        >
          <X size={14} />
        </button>
      </div>

      {editing ? (
        <div>
          <textarea
            ref={editRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              autoGrowEdit();
            }}
            onKeyDown={(e) => {
              if (hasPrimaryShortcutModifier(e) && e.key === "Enter") {
                if (isComposingKeyboardEvent(composing.composingRef, e)) return;
                e.preventDefault();
                handleSave();
              }
            }}
            {...composing.handlers}
            rows={2}
            className="w-full resize-none rounded border border-border p-2 text-sm outline-none focus:border-primary-ring"
            autoFocus
          />
          <div className="mt-1 flex gap-2">
            <button
              onClick={handleSave}
              disabled={!draft.trim()}
              className="rounded bg-primary-solid px-3 py-1 text-xs text-ink-inverted hover:bg-primary-solid-hover disabled:bg-background disabled:text-ink-muted"
            >
              Save
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setDraft(note.content);
              }}
              className="rounded border border-border px-3 py-1 text-xs text-ink-muted hover:bg-background"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => setEditing(true)}
          className="cursor-pointer text-sm text-ink"
        >
          <p className="whitespace-pre-wrap break-words">{note.content}</p>
        </div>
      )}
    </div>
  );
}

function prioritySelectStyle(priority: string): string {
  switch (priority) {
    case "Critical":
      return "border-group-critical-border-strong text-group-critical-fg";
    case "Urgent":
      return "border-group-urgent-border-strong text-group-urgent-fg";
    case "Important":
      return "border-group-important-border-strong text-group-important-fg";
    default:
      return "border-border text-ink";
  }
}
