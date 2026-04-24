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
import { useTaskListStore } from "../../state/task-list-store";
import { usePreferencesStore } from "../../state/preferences-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { showConfirm, showMessage } from "../../repositories";
import {
  formatTimestamp,
  formatDueDate,
  sanitizeSingleLine,
  hasPrimaryShortcutModifier,
} from "../../utils";
import { DatePicker } from "../shared/DatePicker";
import { useComposing, isComposingKeyboardEvent } from "../../hooks/useComposing";
import { useAutoGrow } from "../../hooks/useAutoGrow";

interface TaskDetailProps {
  task: Task;
  filePath: string;
  focusNewNoteSignal: number;
}

export function TaskDetail({
  task,
  filePath,
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
  const [lastTaskId, setLastTaskId] = useState(task.id);
  if (task.id !== lastTaskId) {
    setLastTaskId(task.id);
    setTitleDraft(task.title);
    setDescDraft(task.description);
    setNewNoteContent("");
  }

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const newNoteRef = useRef<HTMLTextAreaElement>(null);
  const titleComposing = useComposing();
  const noteComposing = useComposing();
  const autoGrowTitle = useAutoGrow(titleRef);
  const autoGrowDesc = useAutoGrow(descRef);
  const autoGrowNewNote = useAutoGrow(newNoteRef);

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
      await updateTitle(filePath, task.id, cleaned);
    }
    setTitleDraft(cleaned);
  };

  const handleDescBlur = async () => {
    if (descDraft !== task.description) {
      await updateDescription(filePath, task.id, descDraft);
    }
  };

  const handleStatusChange = async (status: TaskStatus) => {
    await setStatusAction(filePath, task.id, status);
    if (status === "Completed" || status === "Dismissed") {
      setSelection(new Set());
    }
  };

  const handlePriorityChange = async (priority: TaskPriority) => {
    await setPriority(filePath, task.id, priority);
  };

  const handleDueDateChange = async (value: string) => {
    await setDueDate(filePath, task.id, value || null);
  };

  const handleDeleteTask = async () => {
    const confirmed = await showConfirm(
      "Delete Task",
      `Permanently delete "${task.title || "Untitled"}"? This cannot be undone.`,
    );
    if (confirmed) {
      await removeTask(filePath, task.id);
    }
  };

  const handleAddNote = async () => {
    if (!newNoteContent.trim()) return;
    await addNewNote(filePath, task.id, newNoteContent);
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
    // Re-select: in unified view the task is still visible under the new source;
    // in specific list view the ID won't match any task, so summary is shown.
    setSelection(ids);
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
        className="mb-4 w-full shrink-0 resize-none text-lg font-semibold text-gray-800 outline-none placeholder:text-gray-500"
      />

      {/* Status, Priority, Due Date row */}
      <div className="mb-4 flex flex-wrap gap-3">
        {/* Status */}
        <div>
          <label className="mb-1 block text-xs text-gray-500">Status</label>
          <select
            value={task.status}
            onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
            className="rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-700"
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
          <label className="mb-1 block text-xs text-gray-500">Priority</label>
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
          <label className="mb-1 block text-xs text-gray-500">Due</label>
          <DatePicker
            value={task.dueDate}
            onChange={(v) => handleDueDateChange(v ?? "")}
            isOverdue={task.isOverdue}
          />
        </div>
      </div>

      {/* Reorder buttons */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => sendToFirst(filePath)}
          className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
        >
          Tackle
        </button>
        {kickDistances.map((d) => (
          <button
            key={d}
            onClick={() => kick(filePath, d)}
            className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            +{d}
          </button>
        ))}
        <button
          onClick={() => sendToLast(filePath)}
          className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
        >
          Kick
        </button>
        <button
          onClick={() => dropkick(filePath)}
          className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
        >
          Dropkick
        </button>
        <span className="mx-1 text-gray-200">|</span>
        <button
          onClick={handleDeleteTask}
          className="flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-red-200 hover:text-red-700"
        >
          <Trash2 size={12} />
          Delete
        </button>
      </div>

      {/* Move to another list */}
      {moveDestinations.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <label className="text-xs text-gray-500">Move to</label>
          <select
            value={moveTarget}
            onChange={(e) => setMoveTarget(e.target.value)}
            className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600"
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
            className="rounded-md bg-sky-700 px-3 py-1 text-xs text-white hover:bg-sky-800 disabled:bg-gray-50 disabled:text-gray-500"
          >
            Move
          </button>
        </div>
      )}

      {/* Description */}
      <div className="mb-4">
        <label className="mb-1 block text-xs text-gray-500">Description</label>
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
          className="w-full resize-none rounded-md border border-gray-200 p-2 text-sm text-gray-700 outline-none focus:border-sky-400"
        />
      </div>

      {/* Timestamps */}
      <div className="mb-4 space-y-0.5 text-xs text-gray-500">
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
      <div className="border-t border-gray-200 pt-4">
        <h4 className="mb-3 text-sm font-medium text-gray-600">Notes</h4>

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
                handleAddNote();
              }
            }}
            {...noteComposing.handlers}
            placeholder="Add a note... (Cmd+Enter to save)"
            rows={2}
            className="w-full resize-none rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-sky-400"
          />
          <div className="mt-1 flex justify-end">
            <button
              onClick={handleAddNote}
              disabled={!newNoteContent.trim()}
              className="rounded-md bg-sky-700 px-3 py-1 text-xs text-white hover:bg-sky-800 disabled:bg-gray-50 disabled:text-gray-500"
            >
              Add Note
            </button>
          </div>
        </div>

        {/* Notes list */}
        {task.notes.length === 0 ? (
          <div className="py-4 text-center text-sm text-gray-500">
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
      await updateNote(filePath, taskId, note.id, draft);
    }
    setEditing(false);
  };

  const handleDeleteNote = async () => {
    const confirmed = await showConfirm(
      "Delete Note",
      "Permanently delete this note?",
    );
    if (confirmed) {
      await removeNote(filePath, taskId, note.id);
    }
  };

  const handleActionabilityChange = async (actionability: NoteActionability) => {
    await setActionability(filePath, taskId, note.id, actionability);
  };

  const borderColor =
    note.actionability === "Actionable"
      ? "border-orange-400 bg-orange-50"
      : note.actionability === "Resolved"
        ? "border-green-300 bg-green-50/50"
        : "border-gray-200";

  const icon =
    note.actionability === "Actionable" ? (
      <AlertCircle size={14} className="text-orange-700" />
    ) : note.actionability === "Resolved" ? (
      <CheckCircle size={14} className="text-green-700" />
    ) : (
      <Info size={14} className="text-gray-500" />
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
          className="rounded border border-gray-200 px-1 py-0.5 text-xs text-gray-500"
        >
          <option value="Informational">Informational</option>
          <option value="Actionable">Actionable</option>
          <option value="Resolved">Resolved</option>
        </select>

        <span className="ml-auto text-xs text-gray-500">
          {formatTimestamp(
            note.createdAtUtc,
            preferences.dateFormat,
            preferences.timeFormat,
            preferences.timezone,
          )}
        </span>
        <button
          onClick={handleDeleteNote}
          className="rounded p-0.5 text-gray-500 hover:text-red-700"
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
            className="w-full resize-none rounded border border-gray-200 p-2 text-sm outline-none focus:border-sky-400"
            autoFocus
          />
          <div className="mt-1 flex gap-2">
            <button
              onClick={handleSave}
              disabled={!draft.trim()}
              className="rounded bg-sky-700 px-3 py-1 text-xs text-white hover:bg-sky-800 disabled:bg-gray-50 disabled:text-gray-500"
            >
              Save
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setDraft(note.content);
              }}
              className="rounded border border-gray-200 px-3 py-1 text-xs text-gray-500 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => setEditing(true)}
          className="cursor-pointer text-sm text-gray-700"
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
      return "border-violet-300 text-violet-700";
    case "Urgent":
      return "border-rose-300 text-rose-700";
    case "Important":
      return "border-blue-300 text-blue-700";
    default:
      return "border-gray-200 text-gray-600";
  }
}
