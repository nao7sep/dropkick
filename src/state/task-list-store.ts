// TaskListStore — holds all loaded task list data in a map keyed by file path.
// Task lists are loaded lazily (on first tab activation) and kept until the tab closes.

import { create } from "zustand";
import type { TaskListDto, NoteActionability, TaskStatus, TaskPriority } from "../models";
import type { WriteResult } from "../repositories";
import {
  loadTaskList,
  createTaskListFile,
  writeTaskList,
  forceWriteTaskList,
  atomicMoveWrite,
  showFileConflictDialog,
  showFileDeletedDialog,
} from "../repositories";
import { createTask, createNote } from "../utils";
import type { CreateTaskOptions } from "../utils";
import { usePreferencesStore } from "./preferences-store";
import {
  canTransitionStatus,
  kickTasks,
  sendTasksToFirst,
  sendTasksToLast,
  moveTasksUp,
  moveTasksDown,
  dropkickTasks,
  replaceTask,
  addTask,
  deleteTask,
  changeTaskStatus,
  changeTaskPriority,
  changeTaskDueDate,
  updateTaskTitle,
  updateTaskDescription,
  addNote,
  deleteNote,
  updateNoteContent,
  changeNoteActionability,
  prepareMoveOperation,
} from "../services";

// Per-file loaded state.
interface FileState {
  data: TaskListDto;
  hash: string;
}

interface TaskListState {
  // Map of file path → loaded task list data + hash.
  files: Record<string, FileState>;

  // Currently selected task IDs (for the active tab).
  selectedIds: Set<string>;

  // Number of handled tasks visible per file (pagination).
  handledVisible: Record<string, number>;

  // Actions: file management.
  loadFile: (filePath: string) => Promise<boolean>;
  createFile: (filePath: string) => Promise<void>;
  unloadFile: (filePath: string) => void;

  // Actions: selection.
  setSelection: (ids: Set<string>) => void;
  clearSelection: () => void;

  // Actions: handled tasks pagination.
  showMoreHandled: (filePath: string, pageSize: number) => void;

  // Actions: task operations (all write to disk immediately).
  addNewTask: (filePath: string, options: CreateTaskOptions) => Promise<WriteResult>;
  removeTask: (filePath: string, taskId: string) => Promise<WriteResult>;
  updateTitle: (filePath: string, taskId: string, title: string) => Promise<WriteResult>;
  updateDescription: (
    filePath: string,
    taskId: string,
    description: string,
  ) => Promise<WriteResult>;
  setStatus: (filePath: string, taskId: string, status: TaskStatus) => Promise<WriteResult | { status: "validation"; reason: string }>;
  setPriority: (filePath: string, taskId: string, priority: TaskPriority) => Promise<WriteResult>;
  setDueDate: (filePath: string, taskId: string, dueDate: string | null) => Promise<WriteResult>;
  addNewNote: (filePath: string, taskId: string, content: string) => Promise<WriteResult>;
  removeNote: (filePath: string, taskId: string, noteId: string) => Promise<WriteResult>;
  updateNote: (
    filePath: string,
    taskId: string,
    noteId: string,
    content: string,
  ) => Promise<WriteResult>;
  setNoteActionability: (
    filePath: string,
    taskId: string,
    noteId: string,
    actionability: NoteActionability,
  ) => Promise<WriteResult>;
  kick: (filePath: string, distance: number) => Promise<WriteResult>;
  sendToFirst: (filePath: string) => Promise<WriteResult>;
  sendToLast: (filePath: string) => Promise<WriteResult>;
  moveUp: (filePath: string) => Promise<WriteResult>;
  moveDown: (filePath: string) => Promise<WriteResult>;
  dropkick: (filePath: string) => Promise<WriteResult>;
  moveTasks: (
    sourceFilePath: string,
    destFilePath: string,
    taskIds: Set<string>,
  ) => Promise<{ status: "success" } | { status: "error"; message: string }>;

  // Actions: conflict resolution.
  forceWrite: (filePath: string) => Promise<void>;
  reloadFile: (filePath: string) => Promise<void>;

}

// Helper: update a file's data in the map and write to disk.
async function writeFile(
  files: Record<string, FileState>,
  filePath: string,
  newData: TaskListDto,
): Promise<{ files: Record<string, FileState>; result: WriteResult }> {
  const fileState = files[filePath];
  if (!fileState) {
    return { files, result: { status: "error", message: "File not loaded" } };
  }

  const result = await writeTaskList(filePath, newData, fileState.hash);

  if (result.status === "success") {
    return {
      files: {
        ...files,
        [filePath]: { data: newData, hash: result.newHash },
      },
      result,
    };
  }

  if (result.status === "conflict") {
    const choice = await showFileConflictDialog(filePath);
    if (choice === "overwrite") {
      const { hash } = await forceWriteTaskList(filePath, newData);
      return {
        files: {
          ...files,
          [filePath]: { data: newData, hash },
        },
        result: { status: "success", newHash: hash },
      };
    }

    const loaded = await loadTaskList(filePath);
    if (loaded === null) {
      const { [filePath]: _, ...rest } = files;
      return {
        files: rest,
        result: {
          status: "error",
          message: "The file no longer exists. Your in-app change was not saved.",
        },
      };
    }

    return {
      files: {
        ...files,
        [filePath]: { data: loaded.data, hash: loaded.hash },
      },
      result: {
        status: "error",
        message: "The file was reloaded from disk. Your in-app change was not saved.",
      },
    };
  }

  if (result.status === "deleted") {
    const choice = await showFileDeletedDialog(filePath);
    if (choice === "save") {
      const { hash } = await forceWriteTaskList(filePath, newData);
      return {
        files: {
          ...files,
          [filePath]: { data: newData, hash },
        },
        result: { status: "success", newHash: hash },
      };
    }

    return {
      files,
      result: {
        status: "error",
        message: "The file was not recreated. Your in-app change was not saved.",
      },
    };
  }

  return { files, result };
}

function shouldApplyFiles(
  before: Record<string, FileState>,
  after: Record<string, FileState>,
  result: WriteResult,
): boolean {
  return result.status === "success" || after !== before;
}

export const useTaskListStore = create<TaskListState>((set, get) => ({
  files: {},
  selectedIds: new Set(),
  handledVisible: {},

  // --- File management ---

  loadFile: async (filePath: string) => {
    // Don't reload if already loaded.
    if (get().files[filePath]) return true;

    const loaded = await loadTaskList(filePath);
    if (loaded === null) return false;

    set((state) => ({
      files: {
        ...state.files,
        [filePath]: { data: loaded.data, hash: loaded.hash },
      },
    }));
    return true;
  },

  createFile: async (filePath: string) => {
    const loaded = await createTaskListFile(filePath);
    set((state) => ({
      files: {
        ...state.files,
        [filePath]: { data: loaded.data, hash: loaded.hash },
      },
    }));
  },

  unloadFile: (filePath: string) => {
    set((state) => {
      const { [filePath]: _, ...rest } = state.files;
      const { [filePath]: __, ...restHandled } = state.handledVisible;
      return { files: rest, handledVisible: restHandled };
    });
  },

  // --- Selection ---

  setSelection: (ids: Set<string>) => set({ selectedIds: ids }),
  clearSelection: () => set({ selectedIds: new Set() }),

  // --- Handled tasks pagination ---

  showMoreHandled: (filePath: string, pageSize: number) => {
    set((state) => ({
      handledVisible: {
        ...state.handledVisible,
        [filePath]: (state.handledVisible[filePath] ?? pageSize) + pageSize,
      },
    }));
  },

  // --- Task operations ---

  addNewTask: async (filePath: string, options: CreateTaskOptions) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const task = createTask(options);
    const newTasks = addTask(fileState.data.tasks, task);
    const newData = { ...fileState.data, tasks: newTasks };
    const currentFiles = get().files;
    const { files, result } = await writeFile(currentFiles, filePath, newData);
    if (shouldApplyFiles(currentFiles, files, result)) set({ files });
    return result;
  },

  removeTask: async (filePath: string, taskId: string) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const newTasks = deleteTask(fileState.data.tasks, taskId);
    const newData = { ...fileState.data, tasks: newTasks };
    const currentFiles = get().files;
    const { files, result } = await writeFile(currentFiles, filePath, newData);
    if (result.status === "success") {
      set((state) => ({
        files,
        selectedIds: new Set([...state.selectedIds].filter((id) => id !== taskId)),
      }));
    } else if (shouldApplyFiles(currentFiles, files, result)) {
      set({ files });
    }
    return result;
  },

  updateTitle: async (filePath: string, taskId: string, title: string) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;

    const updated = updateTaskTitle(task, title);
    if (updated === task) return { status: "success", newHash: fileState.hash } as WriteResult;
    const newData = { ...fileState.data, tasks: replaceTask(fileState.data.tasks, updated) };
    const currentFiles = get().files;
    const { files, result } = await writeFile(currentFiles, filePath, newData);
    if (shouldApplyFiles(currentFiles, files, result)) set({ files });
    return result;
  },

  updateDescription: async (filePath, taskId, description) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;

    const updated = updateTaskDescription(task, description);
    if (updated === task) return { status: "success", newHash: fileState.hash } as WriteResult;
    const newData = { ...fileState.data, tasks: replaceTask(fileState.data.tasks, updated) };
    const currentFiles = get().files;
    const { files, result } = await writeFile(currentFiles, filePath, newData);
    if (shouldApplyFiles(currentFiles, files, result)) set({ files });
    return result;
  },

  setStatus: async (filePath, taskId, status) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;
    if (task.status === status) {
      return { status: "success", newHash: fileState.hash } as WriteResult;
    }

    // Validate the transition.
    const validation = canTransitionStatus(task, status);
    if (!validation.valid) {
      return { status: "validation", reason: validation.reason! };
    }

    const updated = changeTaskStatus(task, status);
    if (updated === task) return { status: "success", newHash: fileState.hash } as WriteResult;
    const newData = { ...fileState.data, tasks: replaceTask(fileState.data.tasks, updated) };
    const currentFiles = get().files;
    const { files, result } = await writeFile(currentFiles, filePath, newData);
    if (shouldApplyFiles(currentFiles, files, result)) set({ files });
    return result;
  },

  setPriority: async (filePath, taskId, priority) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;

    const updated = changeTaskPriority(task, priority);
    if (updated === task) return { status: "success", newHash: fileState.hash } as WriteResult;
    const newData = { ...fileState.data, tasks: replaceTask(fileState.data.tasks, updated) };
    const currentFiles = get().files;
    const { files, result } = await writeFile(currentFiles, filePath, newData);
    if (shouldApplyFiles(currentFiles, files, result)) set({ files });
    return result;
  },

  setDueDate: async (filePath, taskId, dueDate) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;

    const updated = changeTaskDueDate(task, dueDate);
    if (updated === task) return { status: "success", newHash: fileState.hash } as WriteResult;
    const newData = { ...fileState.data, tasks: replaceTask(fileState.data.tasks, updated) };
    const currentFiles = get().files;
    const { files, result } = await writeFile(currentFiles, filePath, newData);
    if (shouldApplyFiles(currentFiles, files, result)) set({ files });
    return result;
  },

  addNewNote: async (filePath, taskId, content) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;
    if (!content.trim()) {
      return { status: "error", message: "Note content cannot be empty" } as WriteResult;
    }

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;

    const note = createNote(content);
    const updated = addNote(task, note);
    const newData = { ...fileState.data, tasks: replaceTask(fileState.data.tasks, updated) };
    const currentFiles = get().files;
    const { files, result } = await writeFile(currentFiles, filePath, newData);
    if (shouldApplyFiles(currentFiles, files, result)) set({ files });
    return result;
  },

  removeNote: async (filePath, taskId, noteId) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;

    const updated = deleteNote(task, noteId);
    if (updated === task) return { status: "success", newHash: fileState.hash } as WriteResult;
    const newData = { ...fileState.data, tasks: replaceTask(fileState.data.tasks, updated) };
    const currentFiles = get().files;
    const { files, result } = await writeFile(currentFiles, filePath, newData);
    if (shouldApplyFiles(currentFiles, files, result)) set({ files });
    return result;
  },

  updateNote: async (filePath, taskId, noteId, content) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;
    if (!content.trim()) {
      return { status: "error", message: "Note content cannot be empty" } as WriteResult;
    }

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;

    const updated = updateNoteContent(task, noteId, content);
    if (updated === task) return { status: "success", newHash: fileState.hash } as WriteResult;
    const newData = { ...fileState.data, tasks: replaceTask(fileState.data.tasks, updated) };
    const currentFiles = get().files;
    const { files, result } = await writeFile(currentFiles, filePath, newData);
    if (shouldApplyFiles(currentFiles, files, result)) set({ files });
    return result;
  },

  setNoteActionability: async (filePath, taskId, noteId, actionability) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;

    const updated = changeNoteActionability(task, noteId, actionability);
    if (updated === task) return { status: "success", newHash: fileState.hash } as WriteResult;
    const newData = { ...fileState.data, tasks: replaceTask(fileState.data.tasks, updated) };
    const currentFiles = get().files;
    const { files, result } = await writeFile(currentFiles, filePath, newData);
    if (shouldApplyFiles(currentFiles, files, result)) set({ files });
    return result;
  },

  kick: async (filePath, distance) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;
    const { selectedIds } = get();
    if (selectedIds.size === 0) return { status: "error", message: "No tasks selected" } as WriteResult;
    const tz = usePreferencesStore.getState().preferences.timezone;
    const dueSoonDays = usePreferencesStore.getState().preferences.dueSoonDays;
    const newTasks = kickTasks(fileState.data.tasks, selectedIds, distance, tz, dueSoonDays);
    if (newTasks === fileState.data.tasks) {
      return { status: "success", newHash: fileState.hash } as WriteResult;
    }
    const newData = { ...fileState.data, tasks: newTasks };
    const currentFiles = get().files;
    const { files, result } = await writeFile(currentFiles, filePath, newData);
    if (shouldApplyFiles(currentFiles, files, result)) set({ files });
    return result;
  },

  sendToFirst: async (filePath) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;
    const { selectedIds } = get();
    if (selectedIds.size === 0) return { status: "error", message: "No tasks selected" } as WriteResult;
    const tz = usePreferencesStore.getState().preferences.timezone;
    const dueSoonDays = usePreferencesStore.getState().preferences.dueSoonDays;
    const newTasks = sendTasksToFirst(fileState.data.tasks, selectedIds, tz, dueSoonDays);
    if (newTasks === fileState.data.tasks) {
      return { status: "success", newHash: fileState.hash } as WriteResult;
    }
    const newData = { ...fileState.data, tasks: newTasks };
    const currentFiles = get().files;
    const { files, result } = await writeFile(currentFiles, filePath, newData);
    if (shouldApplyFiles(currentFiles, files, result)) set({ files });
    return result;
  },

  sendToLast: async (filePath) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;
    const { selectedIds } = get();
    if (selectedIds.size === 0) return { status: "error", message: "No tasks selected" } as WriteResult;
    const tz = usePreferencesStore.getState().preferences.timezone;
    const dueSoonDays = usePreferencesStore.getState().preferences.dueSoonDays;
    const newTasks = sendTasksToLast(fileState.data.tasks, selectedIds, tz, dueSoonDays);
    if (newTasks === fileState.data.tasks) {
      return { status: "success", newHash: fileState.hash } as WriteResult;
    }
    const newData = { ...fileState.data, tasks: newTasks };
    const currentFiles = get().files;
    const { files, result } = await writeFile(currentFiles, filePath, newData);
    if (shouldApplyFiles(currentFiles, files, result)) set({ files });
    return result;
  },

  moveUp: async (filePath) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;
    const { selectedIds } = get();
    if (selectedIds.size === 0) return { status: "error", message: "No tasks selected" } as WriteResult;
    const tz = usePreferencesStore.getState().preferences.timezone;
    const dueSoonDays = usePreferencesStore.getState().preferences.dueSoonDays;
    const newTasks = moveTasksUp(fileState.data.tasks, selectedIds, tz, dueSoonDays);
    if (newTasks === fileState.data.tasks) {
      return { status: "success", newHash: fileState.hash } as WriteResult;
    }
    const newData = { ...fileState.data, tasks: newTasks };
    const currentFiles = get().files;
    const { files, result } = await writeFile(currentFiles, filePath, newData);
    if (shouldApplyFiles(currentFiles, files, result)) set({ files });
    return result;
  },

  moveDown: async (filePath) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;
    const { selectedIds } = get();
    if (selectedIds.size === 0) return { status: "error", message: "No tasks selected" } as WriteResult;
    const tz = usePreferencesStore.getState().preferences.timezone;
    const dueSoonDays = usePreferencesStore.getState().preferences.dueSoonDays;
    const newTasks = moveTasksDown(fileState.data.tasks, selectedIds, tz, dueSoonDays);
    if (newTasks === fileState.data.tasks) {
      return { status: "success", newHash: fileState.hash } as WriteResult;
    }
    const newData = { ...fileState.data, tasks: newTasks };
    const currentFiles = get().files;
    const { files, result } = await writeFile(currentFiles, filePath, newData);
    if (shouldApplyFiles(currentFiles, files, result)) set({ files });
    return result;
  },

  dropkick: async (filePath) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;
    const { selectedIds } = get();
    if (selectedIds.size === 0) return { status: "error", message: "No tasks selected" } as WriteResult;
    const tz = usePreferencesStore.getState().preferences.timezone;
    const dueSoonDays = usePreferencesStore.getState().preferences.dueSoonDays;
    const newTasks = dropkickTasks(fileState.data.tasks, selectedIds, tz, dueSoonDays);
    if (newTasks === fileState.data.tasks) {
      return { status: "success", newHash: fileState.hash } as WriteResult;
    }
    const newData = { ...fileState.data, tasks: newTasks };
    const currentFiles = get().files;
    const { files, result } = await writeFile(currentFiles, filePath, newData);
    if (shouldApplyFiles(currentFiles, files, result)) set({ files });
    return result;
  },

  moveTasks: async (sourceFilePath, destFilePath, taskIds) => {
    const sourceState = get().files[sourceFilePath];
    const destState = get().files[destFilePath];
    if (!sourceState) return { status: "error", message: "Source file not loaded" };
    if (!destState) return { status: "error", message: "Destination file not loaded" };
    if (sourceFilePath === destFilePath) {
      return { status: "error", message: "Source and destination must be different" };
    }

    const moveResult = prepareMoveOperation(
      sourceState.data.tasks,
      destState.data.tasks,
      taskIds,
    );

    const result = await atomicMoveWrite(
      sourceFilePath,
      moveResult.sourceTasks,
      sourceState.hash,
      destFilePath,
      moveResult.destinationTasks,
      destState.hash,
      destState.data.tasks,
    );

    if (result.status === "success") {
      set((state) => ({
        files: {
          ...state.files,
          [sourceFilePath]: {
            data: { ...sourceState.data, tasks: moveResult.sourceTasks },
            hash: result.sourceHash,
          },
          [destFilePath]: {
            data: { ...destState.data, tasks: moveResult.destinationTasks },
            hash: result.destHash,
          },
        },
        selectedIds: new Set(),
      }));
      return { status: "success" };
    }

    if (result.status === "dest-conflict") {
      return {
        status: "error",
        message:
          "The destination file was modified outside Dropkick. No tasks were moved.",
      };
    }

    if (result.status === "dest-deleted") {
      return {
        status: "error",
        message:
          "The destination file no longer exists. No tasks were moved.",
      };
    }

    if (result.status === "source-conflict") {
      return {
        status: "error",
        message:
          "The source file was modified outside Dropkick. The destination was restored, so no tasks were moved.",
      };
    }

    if (result.status === "source-deleted") {
      return {
        status: "error",
        message:
          "The source file no longer exists. The destination was restored, so no tasks were moved.",
      };
    }

    if (result.status === "rollback-failed") {
      return {
        status: "error",
        message: result.message,
      };
    }

    return {
      status: "error",
      message: result.message,
    };
  },

  // --- Conflict resolution ---

  forceWrite: async (filePath: string) => {
    const fileState = get().files[filePath];
    if (!fileState) return;

    const { hash } = await forceWriteTaskList(filePath, fileState.data);
    set((state) => ({
      files: {
        ...state.files,
        [filePath]: { ...fileState, hash },
      },
    }));
  },

  reloadFile: async (filePath: string) => {
    const loaded = await loadTaskList(filePath);
    if (loaded === null) return;

    set((state) => ({
      files: {
        ...state.files,
        [filePath]: { data: loaded.data, hash: loaded.hash },
      },
      selectedIds: new Set(),
    }));
  },

}));
