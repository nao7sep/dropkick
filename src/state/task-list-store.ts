// TaskListStore — holds all loaded task list data in a map keyed by file path.
// Task lists are loaded lazily (on first tab activation) and kept until the tab closes.

import { create } from "zustand";
import type { TaskListDto, NoteFormat, NoteActionability, TaskStatus, TaskPriority } from "../models";
import type { Task } from "../models";
import type { WriteResult } from "../repositories";
import {
  loadTaskList,
  createTaskListFile,
  writeTaskList,
  forceWriteTaskList,
  atomicMoveWrite,
} from "../repositories";
import { toTask, createTask, createNote } from "../utils";
import {
  canTransitionStatus,
  kickTasks,
  kickTasksToEnd,
  replaceTask,
  addTask,
  changeTaskStatus,
  changeTaskPriority,
  changeTaskDueDate,
  updateTaskTitle,
  updateTaskDescription,
  addNote,
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
  addNewTask: (filePath: string, title: string) => Promise<WriteResult>;
  updateTitle: (filePath: string, taskId: string, title: string) => Promise<WriteResult>;
  updateDescription: (
    filePath: string,
    taskId: string,
    description: string,
    format: NoteFormat,
  ) => Promise<WriteResult>;
  setStatus: (filePath: string, taskId: string, status: TaskStatus) => Promise<WriteResult | { status: "validation"; reason: string }>;
  setPriority: (filePath: string, taskId: string, priority: TaskPriority) => Promise<WriteResult>;
  setDueDate: (filePath: string, taskId: string, dueDate: string | null) => Promise<WriteResult>;
  addNewNote: (filePath: string, taskId: string, content: string) => Promise<WriteResult>;
  updateNote: (
    filePath: string,
    taskId: string,
    noteId: string,
    content: string,
    format: NoteFormat,
  ) => Promise<WriteResult>;
  setNoteActionability: (
    filePath: string,
    taskId: string,
    noteId: string,
    actionability: NoteActionability,
  ) => Promise<WriteResult>;
  kick: (filePath: string, distance: number) => Promise<WriteResult>;
  kickToEnd: (filePath: string) => Promise<WriteResult>;
  moveTasks: (
    sourceFilePath: string,
    destFilePath: string,
    taskIds: Set<string>,
  ) => Promise<{ status: string; message?: string }>;

  // Actions: conflict resolution.
  forceWrite: (filePath: string) => Promise<void>;
  reloadFile: (filePath: string) => Promise<void>;

  // Getters: domain models with computed properties.
  getTasksForFile: (filePath: string, timezone: string | null) => Task[];
  getAllTasks: (timezone: string | null) => Task[];
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

  return { files, result };
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

  addNewTask: async (filePath: string, title: string) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const task = createTask(title);
    const newTasks = addTask(fileState.data.tasks, task);
    const newData = { ...fileState.data, tasks: newTasks };
    const { files, result } = await writeFile(get().files, filePath, newData);
    if (result.status === "success") set({ files });
    return result;
  },

  updateTitle: async (filePath: string, taskId: string, title: string) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;

    const updated = updateTaskTitle(task, title);
    const newData = { ...fileState.data, tasks: replaceTask(fileState.data.tasks, updated) };
    const { files, result } = await writeFile(get().files, filePath, newData);
    if (result.status === "success") set({ files });
    return result;
  },

  updateDescription: async (filePath, taskId, description, format) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;

    const updated = updateTaskDescription(task, description, format);
    const newData = { ...fileState.data, tasks: replaceTask(fileState.data.tasks, updated) };
    const { files, result } = await writeFile(get().files, filePath, newData);
    if (result.status === "success") set({ files });
    return result;
  },

  setStatus: async (filePath, taskId, status) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;

    // Validate the transition.
    const validation = canTransitionStatus(task, status);
    if (!validation.valid) {
      return { status: "validation", reason: validation.reason! };
    }

    const updated = changeTaskStatus(task, status);
    const newData = { ...fileState.data, tasks: replaceTask(fileState.data.tasks, updated) };
    const { files, result } = await writeFile(get().files, filePath, newData);
    if (result.status === "success") set({ files });
    return result;
  },

  setPriority: async (filePath, taskId, priority) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;

    const updated = changeTaskPriority(task, priority);
    const newData = { ...fileState.data, tasks: replaceTask(fileState.data.tasks, updated) };
    const { files, result } = await writeFile(get().files, filePath, newData);
    if (result.status === "success") set({ files });
    return result;
  },

  setDueDate: async (filePath, taskId, dueDate) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;

    const updated = changeTaskDueDate(task, dueDate);
    const newData = { ...fileState.data, tasks: replaceTask(fileState.data.tasks, updated) };
    const { files, result } = await writeFile(get().files, filePath, newData);
    if (result.status === "success") set({ files });
    return result;
  },

  addNewNote: async (filePath, taskId, content) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;

    const note = createNote(content);
    const updated = addNote(task, note);
    const newData = { ...fileState.data, tasks: replaceTask(fileState.data.tasks, updated) };
    const { files, result } = await writeFile(get().files, filePath, newData);
    if (result.status === "success") set({ files });
    return result;
  },

  updateNote: async (filePath, taskId, noteId, content, format) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;

    const updated = updateNoteContent(task, noteId, content, format);
    const newData = { ...fileState.data, tasks: replaceTask(fileState.data.tasks, updated) };
    const { files, result } = await writeFile(get().files, filePath, newData);
    if (result.status === "success") set({ files });
    return result;
  },

  setNoteActionability: async (filePath, taskId, noteId, actionability) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const task = fileState.data.tasks.find((t) => t.id === taskId);
    if (!task) return { status: "error", message: "Task not found" } as WriteResult;

    const updated = changeNoteActionability(task, noteId, actionability);
    const newData = { ...fileState.data, tasks: replaceTask(fileState.data.tasks, updated) };
    const { files, result } = await writeFile(get().files, filePath, newData);
    if (result.status === "success") set({ files });
    return result;
  },

  kick: async (filePath, distance) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const { selectedIds } = get();
    if (selectedIds.size === 0) return { status: "error", message: "No tasks selected" } as WriteResult;

    const newTasks = kickTasks(fileState.data.tasks, selectedIds, distance);
    const newData = { ...fileState.data, tasks: newTasks };
    const { files, result } = await writeFile(get().files, filePath, newData);
    if (result.status === "success") set({ files });
    return result;
  },

  kickToEnd: async (filePath) => {
    const fileState = get().files[filePath];
    if (!fileState) return { status: "error", message: "File not loaded" } as WriteResult;

    const { selectedIds } = get();
    if (selectedIds.size === 0) return { status: "error", message: "No tasks selected" } as WriteResult;

    const newTasks = kickTasksToEnd(fileState.data.tasks, selectedIds);
    const newData = { ...fileState.data, tasks: newTasks };
    const { files, result } = await writeFile(get().files, filePath, newData);
    if (result.status === "success") set({ files });
    return result;
  },

  moveTasks: async (sourceFilePath, destFilePath, taskIds) => {
    const sourceState = get().files[sourceFilePath];
    const destState = get().files[destFilePath];
    if (!sourceState) return { status: "error", message: "Source file not loaded" };
    if (!destState) return { status: "error", message: "Destination file not loaded" };

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
    }

    return result;
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

  // --- Getters ---

  getTasksForFile: (filePath: string, timezone: string | null): Task[] => {
    const fileState = get().files[filePath];
    if (!fileState) return [];
    return fileState.data.tasks.map((dto) => toTask(dto, filePath, timezone));
  },

  getAllTasks: (timezone: string | null): Task[] => {
    const { files } = get();
    const allTasks: Task[] = [];
    for (const [filePath, fileState] of Object.entries(files)) {
      for (const dto of fileState.data.tasks) {
        allTasks.push(toTask(dto, filePath, timezone));
      }
    }
    return allTasks;
  },
}));
