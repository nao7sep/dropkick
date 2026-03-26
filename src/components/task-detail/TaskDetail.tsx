// Single task detail — shown in right pane when exactly 1 task is selected.
// All fields are editable inline. Notes are listed newest first.

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertCircle,
  CheckCircle,
  Info,
  Plus,
  Eye,
  EyeOff,
} from "lucide-react";
import type { Task, TaskStatus, TaskPriority, NoteDto, NoteFormat, NoteActionability } from "../../models";
import { useTaskListStore } from "../../state/task-list-store";
import { usePreferencesStore } from "../../state/preferences-store";
import { formatTimestamp, formatDueDate } from "../../utils";

interface TaskDetailProps {
  task: Task;
  filePath: string;
}

export function TaskDetail({ task, filePath }: TaskDetailProps) {
  const preferences = usePreferencesStore((s) => s.preferences);
  const updateTitle = useTaskListStore((s) => s.updateTitle);
  const updateDescription = useTaskListStore((s) => s.updateDescription);
  const setStatusAction = useTaskListStore((s) => s.setStatus);
  const setPriority = useTaskListStore((s) => s.setPriority);
  const setDueDate = useTaskListStore((s) => s.setDueDate);
  const addNewNote = useTaskListStore((s) => s.addNewNote);
  const kickDistances = preferences.kickDistances;
  const kick = useTaskListStore((s) => s.kick);
  const kickToEnd = useTaskListStore((s) => s.kickToEnd);

  const [titleDraft, setTitleDraft] = useState(task.title);
  const [descDraft, setDescDraft] = useState(task.description);
  const [descFormat, setDescFormat] = useState<NoteFormat>(task.descriptionFormat);
  const [showDescPreview, setShowDescPreview] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState("");

  // Sync drafts when task changes.
  const [lastTaskId, setLastTaskId] = useState(task.id);
  if (task.id !== lastTaskId) {
    setLastTaskId(task.id);
    setTitleDraft(task.title);
    setDescDraft(task.description);
    setDescFormat(task.descriptionFormat);
    setShowDescPreview(false);
    setNewNoteContent("");
  }

  const handleTitleBlur = async () => {
    if (titleDraft !== task.title) {
      await updateTitle(filePath, task.id, titleDraft);
    }
  };

  const handleDescBlur = async () => {
    if (descDraft !== task.description || descFormat !== task.descriptionFormat) {
      await updateDescription(filePath, task.id, descDraft, descFormat);
    }
  };

  const handleStatusChange = async (status: TaskStatus) => {
    await setStatusAction(filePath, task.id, status);
  };

  const handlePriorityChange = async (priority: TaskPriority) => {
    await setPriority(filePath, task.id, priority);
  };

  const handleDueDateChange = async (value: string) => {
    await setDueDate(filePath, task.id, value || null);
  };

  const handleAddNote = async () => {
    if (!newNoteContent.trim()) return;
    await addNewNote(filePath, task.id, newNoteContent.trim());
    setNewNoteContent("");
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      {/* Title */}
      <input
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={handleTitleBlur}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        placeholder="Task title..."
        className="mb-4 w-full text-lg font-semibold text-gray-800 outline-none placeholder:text-gray-300"
      />

      {/* Status, Priority, Due Date row */}
      <div className="mb-4 flex flex-wrap gap-3">
        {/* Status */}
        <div>
          <label className="mb-1 block text-xs text-gray-400">Status</label>
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
          <label className="mb-1 block text-xs text-gray-400">Priority</label>
          <select
            value={task.priority}
            onChange={(e) => handlePriorityChange(e.target.value as TaskPriority)}
            className={`rounded-md border px-2 py-1 text-sm ${prioritySelectStyle(task.priority)}`}
          >
            <option value="Critical">Critical</option>
            <option value="Urgent">Urgent</option>
            <option value="Important">Important</option>
            <option value="Default">Default</option>
          </select>
        </div>

        {/* Due Date */}
        <div>
          <label className="mb-1 block text-xs text-gray-400">Due</label>
          <input
            type="date"
            value={task.dueDate ?? ""}
            onChange={(e) => handleDueDateChange(e.target.value)}
            className={`rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-700 ${
              task.isOverdue ? "border-red-300 text-red-600" : ""
            }`}
          />
        </div>
      </div>

      {/* Kick buttons */}
      <div className="mb-4 flex gap-2">
        {kickDistances.map((d) => (
          <button
            key={d}
            onClick={() => kick(filePath, d)}
            className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50"
          >
            +{d}
          </button>
        ))}
        <button
          onClick={() => kickToEnd(filePath)}
          className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50"
        >
          ↓ End
        </button>
      </div>

      {/* Description */}
      <div className="mb-4">
        <div className="mb-1 flex items-center gap-2">
          <label className="text-xs text-gray-400">Description</label>
          <select
            value={descFormat}
            onChange={(e) => setDescFormat(e.target.value as NoteFormat)}
            className="rounded border border-gray-200 px-1 py-0.5 text-xs text-gray-500"
          >
            <option value="plaintext">Plain text</option>
            <option value="markdown">Markdown</option>
          </select>
          {descFormat === "markdown" && (
            <button
              onClick={() => setShowDescPreview(!showDescPreview)}
              className="text-gray-400 hover:text-gray-600"
              title={showDescPreview ? "Edit" : "Preview"}
            >
              {showDescPreview ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          )}
        </div>

        {showDescPreview && descFormat === "markdown" ? (
          <div className="prose prose-sm max-w-none rounded-md border border-gray-200 p-3">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {descDraft || "*No description*"}
            </ReactMarkdown>
          </div>
        ) : (
          <textarea
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={handleDescBlur}
            rows={4}
            placeholder="Add a description..."
            className="w-full resize-y rounded-md border border-gray-200 p-2 text-sm text-gray-700 outline-none focus:border-blue-300"
          />
        )}
      </div>

      {/* Timestamps */}
      <div className="mb-4 space-y-0.5 text-xs text-gray-400">
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
        <div className="mb-3 flex gap-2">
          <input
            value={newNoteContent}
            onChange={(e) => setNewNoteContent(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddNote(); }}
            placeholder="Add a note..."
            className="flex-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300"
          />
          <button
            onClick={handleAddNote}
            disabled={!newNoteContent.trim()}
            className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Notes list */}
        {task.notes.length === 0 ? (
          <div className="py-4 text-center text-sm text-gray-400">
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
  const setActionability = useTaskListStore((s) => s.setNoteActionability);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const [format, setFormat] = useState<NoteFormat>(note.format);

  const handleSave = async () => {
    if (draft !== note.content || format !== note.format) {
      await updateNote(filePath, taskId, note.id, draft, format);
    }
    setEditing(false);
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
      <AlertCircle size={14} className="text-orange-500" />
    ) : note.actionability === "Resolved" ? (
      <CheckCircle size={14} className="text-green-500" />
    ) : (
      <Info size={14} className="text-gray-400" />
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

        <span className="ml-auto text-xs text-gray-400">
          {formatTimestamp(
            note.createdAtUtc,
            preferences.dateFormat,
            preferences.timeFormat,
            preferences.timezone,
          )}
        </span>
      </div>

      {editing ? (
        <div>
          <div className="mb-1 flex items-center gap-2">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as NoteFormat)}
              className="rounded border border-gray-200 px-1 py-0.5 text-xs text-gray-500"
            >
              <option value="plaintext">Plain text</option>
              <option value="markdown">Markdown</option>
            </select>
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full resize-y rounded border border-gray-200 p-2 text-sm outline-none focus:border-blue-300"
            autoFocus
          />
          <div className="mt-1 flex gap-2">
            <button
              onClick={handleSave}
              className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
            >
              Save
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setDraft(note.content);
                setFormat(note.format);
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
          {note.format === "markdown" && !editing ? (
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {note.content}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="whitespace-pre-wrap">{note.content}</p>
          )}
        </div>
      )}
    </div>
  );
}

function prioritySelectStyle(priority: string): string {
  switch (priority) {
    case "Critical":
      return "border-red-300 text-red-600";
    case "Urgent":
      return "border-amber-300 text-amber-600";
    case "Important":
      return "border-blue-300 text-blue-600";
    default:
      return "border-gray-200 text-gray-600";
  }
}
