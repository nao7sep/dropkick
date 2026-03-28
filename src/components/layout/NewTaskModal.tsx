// New Task modal — Ctrl+N opens this to create a task with full attributes.

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { TaskPriority } from "../../models";
import { sanitizeSingleLine } from "../../utils";
import { useWorkspaceStore } from "../../state/workspace-store";
import { useTaskListStore } from "../../state/task-list-store";
import { DatePicker } from "../shared/DatePicker";

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
  const setSelection = useTaskListStore((s) => s.setSelection);
  const files = useTaskListStore((s) => s.files);

  const fileTabs = workspace.openTabs.filter((t) => !t.isUnifiedView);

  // In unified view, don't auto-select — require explicit choice.
  const defaultTarget =
    !isUnifiedView && currentFilePath ? currentFilePath : "";

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("Default");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [targetFile, setTargetFile] = useState(defaultTarget);
  const [submitting, setSubmitting] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  const canCreate = targetFile !== "" && fileTabs.length > 0;

  const handleCreate = async () => {
    if (!canCreate || submitting) return;

    setSubmitting(true);
    try {
      const fileState = files[targetFile];
      const prevCount = fileState?.data.tasks.length ?? 0;

      const result = await addNewTask(targetFile, {
        title: sanitizeSingleLine(title),
        description,
        priority,
        dueDate,
      });

      if (result.status === "success") {
        const updatedFiles = useTaskListStore.getState().files;
        const updatedState = updatedFiles[targetFile];
        if (updatedState && updatedState.data.tasks.length > prevCount) {
          const newTask = updatedState.data.tasks[0];
          if (newTask) {
            setSelection(new Set([newTask.id]));
          }
        }
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter in the title input submits (but not in the textarea).
    if (e.key === "Enter" && (e.target as HTMLElement)?.tagName !== "TEXTAREA") {
      e.preventDefault();
      handleCreate();
    }
  };

  const fileLabel = (path: string) => {
    const parts = path.split(/[\\/]/);
    return (parts[parts.length - 1] ?? "").replace(/\.json$/, "");
  };

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
    >
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-800">New Task</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 overflow-y-auto px-6 py-5" onKeyDown={handleKeyDown}>
          {/* Target list */}
          {fileTabs.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Add to list
              </label>
              <select
                value={targetFile}
                onChange={(e) => setTargetFile(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300"
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
            <p className="text-xs text-red-500">
              No task lists open. Open or create a task list first.
            </p>
          )}

          {/* Title */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Title
            </label>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title (optional)"
              className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details..."
              rows={3}
              className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300"
            />
          </div>

          {/* Priority and Due date — side by side */}
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300"
              >
                <option value="Default">Default</option>
                <option value="Important">Important</option>
                <option value="Urgent">Urgent</option>
                <option value="Critical">Critical</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Due date
              </label>
              <DatePicker value={dueDate} onChange={setDueDate} popoverPosition="above" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate || submitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
