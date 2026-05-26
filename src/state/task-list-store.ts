// TaskListStore — holds all loaded task list data in a map keyed by file path.
// Task lists are loaded lazily (on first tab activation) and kept until the tab closes.

import { create } from "zustand";
import type { TaskListDto, NoteActionability, TaskStatus, TaskPriority } from "../models";
import type { LoadTaskListResult, WriteResult } from "../repositories";
import {
  loadTaskList,
  createTaskListFile,
  writeTaskList,
  forceWriteTaskList,
  moveTasksBetweenFilesWithRollback,
  showFileConflictDialog,
  showFileDeletedDialog,
} from "../repositories";
import { createTask, createNote, parseTaskKey, taskKey } from "../utils";
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

type LoadFileResult =
  | { status: "success" }
  | { status: "missing" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

type FileLoadError =
  | { status: "missing" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

interface TaskListState {
  // Map of file path → loaded task list data + hash.
  files: Record<string, FileState>;

  // Map of file path → latest failed load result.
  fileLoadErrors: Record<string, FileLoadError>;

  // Currently selected task keys (source file + task ID) for the active tab.
  selectedKeys: Set<string>;

  // Number of handled tasks visible per task-list view (pagination).
  handledVisible: Record<string, number>;

  // Expanded/collapsed handled section state for the current app session.
  handledExpanded: Record<string, boolean>;

  // Actions: file management.
  loadFile: (filePath: string) => Promise<LoadFileResult>;
  createFile: (filePath: string) => Promise<void>;
  unloadFile: (filePath: string) => void;

  // Actions: selection.
  setSelection: (keys: Set<string>) => void;
  clearSelection: () => void;

  // Actions: handled tasks pagination.
  showMoreHandled: (viewKey: string, pageSize: number) => void;
  setHandledExpanded: (viewKey: string, expanded: boolean) => void;

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
  addNewNote: (
    filePath: string,
    taskId: string,
    content: string,
    actionability?: NoteActionability,
  ) => Promise<WriteResult>;
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
    if (loaded.status === "missing") {
      const { [filePath]: _, ...rest } = files;
      return {
        files: rest,
        result: {
          status: "error",
          message: "The file no longer exists. Your in-app change was not saved.",
        },
      };
    }

    if (loaded.status !== "success") {
      return {
        files,
        result: {
          status: "error",
          message: `The file changed outside Dropkick but could not be reloaded: ${loaded.message}`,
        },
      };
    }

    return {
      files: {
        ...files,
        [filePath]: {
          data: loaded.taskList.data,
          hash: loaded.taskList.hash,
        },
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

function loadResultToStoreResult(result: LoadTaskListResult): LoadFileResult {
  if (result.status === "success") return { status: "success" };
  return result;
}

function selectedTaskIdsForFile(
  selectedKeys: Set<string>,
  filePath: string,
): Set<string> {
  const taskIds = new Set<string>();
  for (const key of selectedKeys) {
    const parsed = parseTaskKey(key);
    if (parsed?.sourceFile === filePath) {
      taskIds.add(parsed.taskId);
    }
  }
  return taskIds;
}

function removeRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

export const useTaskListStore = create<TaskListState>((set, get) => ({
  files: {},
  fileLoadErrors: {},
  selectedKeys: new Set(),
  handledVisible: {},
  handledExpanded: {},

  // --- File management ---

  loadFile: async (filePath: string) => {
    // Don't reload if already loaded.
    if (get().files[filePath]) return { status: "success" };

    const loaded = await loadTaskList(filePath);
    if (loaded.status !== "success") {
      set((state) => ({
        fileLoadErrors: {
          ...state.fileLoadErrors,
          [filePath]: loaded,
        },
      }));
      return loadResultToStoreResult(loaded);
    }

    set((state) => ({
      files: {
        ...state.files,
        [filePath]: { data: loaded.taskList.data, hash: loaded.taskList.hash },
      },
      fileLoadErrors: removeRecordKey(state.fileLoadErrors, filePath),
    }));
    return { status: "success" };
  },

  createFile: async (filePath: string) => {
    const loaded = await createTaskListFile(filePath);
    set((state) => ({
      files: {
        ...state.files,
        [filePath]: { data: loaded.data, hash: loaded.hash },
      },
      fileLoadErrors: removeRecordKey(state.fileLoadErrors, filePath),
    }));
  },

  unloadFile: (filePath: string) => {
    set((state) => {
      const { [filePath]: _, ...rest } = state.files;
      const { [filePath]: __, ...restHandled } = state.handledVisible;
      const { [filePath]: ___, ...restExpanded } = state.handledExpanded;
      const { [filePath]: ____, ...restErrors } = state.fileLoadErrors;
      return {
        files: rest,
        fileLoadErrors: restErrors,
        handledVisible: restHandled,
        handledExpanded: restExpanded,
      };
    });
  },

  // --- Selection ---

  setSelection: (keys: Set<string>) => set({ selectedKeys: keys }),
  clearSelection: () => set({ selectedKeys: new Set() }),

  // --- Handled tasks pagination ---

  showMoreHandled: (viewKey: string, pageSize: number) => {
    set((state) => ({
      handledVisible: {
        ...state.handledVisible,
        [viewKey]: (state.handledVisible[viewKey] ?? pageSize) + pageSize,
      },
    }));
  },

  setHandledExpanded: (viewKey: string, expanded: boolean) => {
    set((state) => ({
      handledExpanded: {
        ...state.handledExpanded,
        [viewKey]: expanded,
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
        selectedKeys: new Set(
          [...state.selectedKeys].filter(
            (key) => key !== taskKey(filePath, taskId),
          ),
        ),
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

  addNewNote: async (filePath, taskId, content, actionability = "Informational") => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;
    if (!content.trim()) {
      return { status: "error", message: "Note content cannot be empty" } as WriteResult;
    }

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;

    const note = createNote(content, actionability);
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
    const selectedTaskIds = selectedTaskIdsForFile(get().selectedKeys, filePath);
    if (selectedTaskIds.size === 0) return { status: "error", message: "No tasks selected" } as WriteResult;
    const tz = usePreferencesStore.getState().preferences.timezone;
    const dueSoonDays = usePreferencesStore.getState().preferences.dueSoonDays;
    const newTasks = kickTasks(fileState.data.tasks, selectedTaskIds, distance, tz, dueSoonDays);
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
    const selectedTaskIds = selectedTaskIdsForFile(get().selectedKeys, filePath);
    if (selectedTaskIds.size === 0) return { status: "error", message: "No tasks selected" } as WriteResult;
    const tz = usePreferencesStore.getState().preferences.timezone;
    const dueSoonDays = usePreferencesStore.getState().preferences.dueSoonDays;
    const newTasks = sendTasksToFirst(fileState.data.tasks, selectedTaskIds, tz, dueSoonDays);
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
    const selectedTaskIds = selectedTaskIdsForFile(get().selectedKeys, filePath);
    if (selectedTaskIds.size === 0) return { status: "error", message: "No tasks selected" } as WriteResult;
    const tz = usePreferencesStore.getState().preferences.timezone;
    const dueSoonDays = usePreferencesStore.getState().preferences.dueSoonDays;
    const newTasks = sendTasksToLast(fileState.data.tasks, selectedTaskIds, tz, dueSoonDays);
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
    const selectedTaskIds = selectedTaskIdsForFile(get().selectedKeys, filePath);
    if (selectedTaskIds.size === 0) return { status: "error", message: "No tasks selected" } as WriteResult;
    const tz = usePreferencesStore.getState().preferences.timezone;
    const dueSoonDays = usePreferencesStore.getState().preferences.dueSoonDays;
    const newTasks = moveTasksUp(fileState.data.tasks, selectedTaskIds, tz, dueSoonDays);
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
    const selectedTaskIds = selectedTaskIdsForFile(get().selectedKeys, filePath);
    if (selectedTaskIds.size === 0) return { status: "error", message: "No tasks selected" } as WriteResult;
    const tz = usePreferencesStore.getState().preferences.timezone;
    const dueSoonDays = usePreferencesStore.getState().preferences.dueSoonDays;
    const newTasks = moveTasksDown(fileState.data.tasks, selectedTaskIds, tz, dueSoonDays);
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
    const selectedTaskIds = selectedTaskIdsForFile(get().selectedKeys, filePath);
    if (selectedTaskIds.size === 0) return { status: "error", message: "No tasks selected" } as WriteResult;
    const tz = usePreferencesStore.getState().preferences.timezone;
    const dueSoonDays = usePreferencesStore.getState().preferences.dueSoonDays;
    const newTasks = dropkickTasks(fileState.data.tasks, selectedTaskIds, tz, dueSoonDays);
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

    const result = await moveTasksBetweenFilesWithRollback(
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
        selectedKeys: new Set(),
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
    if (loaded.status !== "success") {
      set((state) => ({
        fileLoadErrors: {
          ...state.fileLoadErrors,
          [filePath]: loaded,
        },
      }));
      return;
    }

    set((state) => ({
      files: {
        ...state.files,
        [filePath]: { data: loaded.taskList.data, hash: loaded.taskList.hash },
      },
      fileLoadErrors: removeRecordKey(state.fileLoadErrors, filePath),
      selectedKeys: new Set(),
    }));
  },

}));
