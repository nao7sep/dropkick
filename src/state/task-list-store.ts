// TaskListStore — holds all loaded task list data in a map keyed by file path.
// Task lists are loaded lazily (on first tab activation) and kept until the tab closes.
//
// Mutations are split into two phases:
//   1. A synchronous validation + `set((state) => …)` that updates the latest
//      store state. Because zustand's `set` runs synchronously, no two
//      mutations interleave at this stage.
//   2. An asynchronous flush via the repository, which serializes writes per
//      file path. Multiple mutations queued in quick succession are written in
//      order and never race the SHA-256 hash check against each other.
//
// The repository owns the hash internally, so the store no longer tracks one.

import { create } from "zustand";
import type {
  TaskListDto,
  NoteActionability,
  TaskStatus,
  TaskPriority,
} from "../models";
import type { LoadTaskListResult, WriteResult, MoveInputs } from "../repositories";
import {
  loadTaskList,
  createTaskListFile,
  flushTaskList,
  forceFlushTaskList,
  flushMove,
  forgetTaskList,
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

// Per-file loaded state. The repository owns the hash; the store holds data.
interface FileState {
  data: TaskListDto;
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

// Result returned to UI callers of mutating actions.
export type ActionResult =
  | { status: "success" }
  | { status: "validation"; reason: string }
  | { status: "error"; message: string };

interface TaskListState {
  // Map of file path → loaded task list data.
  files: Record<string, FileState>;

  // Map of file path → latest failed load result.
  fileLoadErrors: Record<string, FileLoadError>;

  // Currently selected task keys (source file + task ID) for the active tab.
  selectedKeys: Set<string>;

  // Number of handled tasks visible per task-list view (pagination).
  handledVisible: Record<string, number>;

  // Expanded/collapsed handled section state for the current app session.
  handledExpanded: Record<string, boolean>;

  // Bumped by reorder actions (kick/tackle/move up/down) when they change task
  // order while keeping the selection. The task list watches this to re-scroll
  // the still-selected task into view as it moves. Mutations that *advance* the
  // selection (status/priority/due/dropkick) deliberately do NOT bump it — they
  // scroll via the selection change instead, which avoids chasing the stale
  // pre-advance selection during the intermediate render.
  reorderTick: number;

  // Actions: file management.
  loadFile: (filePath: string) => Promise<LoadFileResult>;
  createFile: (filePath: string) => Promise<void>;
  unloadFile: (filePath: string) => Promise<void>;

  // Actions: selection.
  setSelection: (keys: Set<string>) => void;
  clearSelection: () => void;

  // Actions: handled tasks pagination.
  showMoreHandled: (viewKey: string, pageSize: number) => void;
  setHandledExpanded: (viewKey: string, expanded: boolean) => void;

  // Actions: task operations (each persists asynchronously).
  addNewTask: (
    filePath: string,
    options: CreateTaskOptions,
  ) => Promise<ActionResult>;
  removeTask: (filePath: string, taskId: string) => Promise<ActionResult>;
  updateTitle: (
    filePath: string,
    taskId: string,
    title: string,
  ) => Promise<ActionResult>;
  updateDescription: (
    filePath: string,
    taskId: string,
    description: string,
  ) => Promise<ActionResult>;
  setStatus: (
    filePath: string,
    taskId: string,
    status: TaskStatus,
  ) => Promise<ActionResult>;
  setPriority: (
    filePath: string,
    taskId: string,
    priority: TaskPriority,
  ) => Promise<ActionResult>;
  setDueDate: (
    filePath: string,
    taskId: string,
    dueDate: string | null,
  ) => Promise<ActionResult>;
  addNewNote: (
    filePath: string,
    taskId: string,
    content: string,
    actionability?: NoteActionability,
  ) => Promise<ActionResult>;
  removeNote: (
    filePath: string,
    taskId: string,
    noteId: string,
  ) => Promise<ActionResult>;
  updateNote: (
    filePath: string,
    taskId: string,
    noteId: string,
    content: string,
  ) => Promise<ActionResult>;
  setNoteActionability: (
    filePath: string,
    taskId: string,
    noteId: string,
    actionability: NoteActionability,
  ) => Promise<ActionResult>;
  kick: (filePath: string, distance: number) => Promise<ActionResult>;
  sendToFirst: (filePath: string) => Promise<ActionResult>;
  sendToLast: (filePath: string) => Promise<ActionResult>;
  moveUp: (filePath: string) => Promise<ActionResult>;
  moveDown: (filePath: string) => Promise<ActionResult>;
  dropkick: (filePath: string) => Promise<ActionResult>;
  moveTasks: (
    sourceFilePath: string,
    destFilePath: string,
    taskIds: Set<string>,
  ) => Promise<{ status: "success" } | { status: "error"; message: string }>;

  // Actions: conflict resolution.
  forceWrite: (filePath: string) => Promise<void>;
  reloadFile: (filePath: string) => Promise<void>;
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

function removeRecordKey<T>(
  record: Record<string, T>,
  key: string,
): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

export const useTaskListStore = create<TaskListState>((set, get) => {
  // Helper: replace one file's data via a synchronous state transition. Reads
  // the latest store state so concurrent transitions never overwrite each
  // other's in-memory updates.
  function applyData(filePath: string, data: TaskListDto): void {
    set((state) => {
      if (!state.files[filePath]) return state;
      return {
        files: {
          ...state.files,
          [filePath]: { data },
        },
      };
    });
  }

  // Helper: queue a flush for the given file and translate the repository's
  // WriteResult into an ActionResult. If the disk was modified outside
  // Dropkick and the user chose Reload, the reloaded data is applied to the
  // store here so the UI reflects the disk state.
  async function flush(filePath: string): Promise<ActionResult> {
    const result = await flushTaskList(filePath, () => {
      const f = get().files[filePath];
      if (!f) {
        throw new Error(`File not loaded: ${filePath}`);
      }
      return f.data;
    });

    if (result.status === "success") return { status: "success" };
    if (result.status === "error") {
      return { status: "error", message: result.message };
    }
    // reloaded
    applyData(filePath, result.data);
    return { status: "error", message: result.message };
  }

  return {
    files: {},
    fileLoadErrors: {},
    selectedKeys: new Set(),
    handledVisible: {},
    handledExpanded: {},
    reorderTick: 0,

    // --- File management ---

    loadFile: async (filePath: string) => {
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
          [filePath]: { data: loaded.taskList.data },
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
          [filePath]: { data: loaded.data },
        },
        fileLoadErrors: removeRecordKey(state.fileLoadErrors, filePath),
      }));
    },

    unloadFile: async (filePath: string) => {
      // Drain any pending writes for this path before removing the entry from
      // memory. forgetTaskList runs inside the path's serial chain, so any
      // queued flush completes (using the still-present in-memory data) before
      // the hash is dropped.
      await forgetTaskList(filePath);
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
    //
    // Each action is:
    //   1. Sync precheck (existence / validation). Returns synchronously on
    //      validation failure.
    //   2. Sync `set((state) => …)` that re-reads the latest state and applies
    //      the change. If the world changed between precheck and set (rare
    //      because no await separates them, but a defensive no-op is cheap),
    //      the updater returns state unchanged.
    //   3. Async flush.

    addNewTask: async (filePath, options) => {
      if (!get().files[filePath]) {
        return { status: "error", message: "File not loaded" };
      }
      const task = createTask(options);
      set((state) => {
        const f = state.files[filePath];
        if (!f) return state;
        return {
          files: {
            ...state.files,
            [filePath]: { data: { ...f.data, tasks: addTask(f.data.tasks, task) } },
          },
        };
      });
      return flush(filePath);
    },

    removeTask: async (filePath, taskId) => {
      const fileState = get().files[filePath];
      if (!fileState) return { status: "error", message: "File not loaded" };
      set((state) => {
        const f = state.files[filePath];
        if (!f) return state;
        return {
          files: {
            ...state.files,
            [filePath]: { data: { ...f.data, tasks: deleteTask(f.data.tasks, taskId) } },
          },
          selectedKeys: new Set(
            [...state.selectedKeys].filter((k) => k !== taskKey(filePath, taskId)),
          ),
        };
      });
      return flush(filePath);
    },

    updateTitle: async (filePath, taskId, title) => {
      const fileState = get().files[filePath];
      if (!fileState) return { status: "error", message: "File not loaded" };
      const task = fileState.data.tasks.find((t) => t.id === taskId);
      if (!task) return { status: "error", message: "Task not found" };

      const updated = updateTaskTitle(task, title);
      if (updated === task) return { status: "success" };

      set((state) => {
        const f = state.files[filePath];
        if (!f) return state;
        const current = f.data.tasks.find((t) => t.id === taskId);
        if (!current) return state;
        const next = updateTaskTitle(current, title);
        if (next === current) return state;
        return {
          files: {
            ...state.files,
            [filePath]: { data: { ...f.data, tasks: replaceTask(f.data.tasks, next) } },
          },
        };
      });
      return flush(filePath);
    },

    updateDescription: async (filePath, taskId, description) => {
      const fileState = get().files[filePath];
      if (!fileState) return { status: "error", message: "File not loaded" };
      const task = fileState.data.tasks.find((t) => t.id === taskId);
      if (!task) return { status: "error", message: "Task not found" };

      const updated = updateTaskDescription(task, description);
      if (updated === task) return { status: "success" };

      set((state) => {
        const f = state.files[filePath];
        if (!f) return state;
        const current = f.data.tasks.find((t) => t.id === taskId);
        if (!current) return state;
        const next = updateTaskDescription(current, description);
        if (next === current) return state;
        return {
          files: {
            ...state.files,
            [filePath]: { data: { ...f.data, tasks: replaceTask(f.data.tasks, next) } },
          },
        };
      });
      return flush(filePath);
    },

    setStatus: async (filePath, taskId, status) => {
      const fileState = get().files[filePath];
      if (!fileState) return { status: "error", message: "File not loaded" };
      const task = fileState.data.tasks.find((t) => t.id === taskId);
      if (!task) return { status: "error", message: "Task not found" };
      if (task.status === status) return { status: "success" };

      const validation = canTransitionStatus(task, status);
      if (!validation.valid) {
        return { status: "validation", reason: validation.reason! };
      }

      set((state) => {
        const f = state.files[filePath];
        if (!f) return state;
        const current = f.data.tasks.find((t) => t.id === taskId);
        if (!current) return state;
        const next = changeTaskStatus(current, status);
        if (next === current) return state;
        return {
          files: {
            ...state.files,
            [filePath]: { data: { ...f.data, tasks: replaceTask(f.data.tasks, next) } },
          },
        };
      });
      return flush(filePath);
    },

    setPriority: async (filePath, taskId, priority) => {
      const fileState = get().files[filePath];
      if (!fileState) return { status: "error", message: "File not loaded" };
      const task = fileState.data.tasks.find((t) => t.id === taskId);
      if (!task) return { status: "error", message: "Task not found" };

      const updated = changeTaskPriority(task, priority);
      if (updated === task) return { status: "success" };

      set((state) => {
        const f = state.files[filePath];
        if (!f) return state;
        const current = f.data.tasks.find((t) => t.id === taskId);
        if (!current) return state;
        const next = changeTaskPriority(current, priority);
        if (next === current) return state;
        return {
          files: {
            ...state.files,
            [filePath]: { data: { ...f.data, tasks: replaceTask(f.data.tasks, next) } },
          },
        };
      });
      return flush(filePath);
    },

    setDueDate: async (filePath, taskId, dueDate) => {
      const fileState = get().files[filePath];
      if (!fileState) return { status: "error", message: "File not loaded" };
      const task = fileState.data.tasks.find((t) => t.id === taskId);
      if (!task) return { status: "error", message: "Task not found" };

      const updated = changeTaskDueDate(task, dueDate);
      if (updated === task) return { status: "success" };

      set((state) => {
        const f = state.files[filePath];
        if (!f) return state;
        const current = f.data.tasks.find((t) => t.id === taskId);
        if (!current) return state;
        const next = changeTaskDueDate(current, dueDate);
        if (next === current) return state;
        return {
          files: {
            ...state.files,
            [filePath]: { data: { ...f.data, tasks: replaceTask(f.data.tasks, next) } },
          },
        };
      });
      return flush(filePath);
    },

    addNewNote: async (filePath, taskId, content, actionability = "Informational") => {
      if (!get().files[filePath]) {
        return { status: "error", message: "File not loaded" };
      }
      if (!content.trim()) {
        return { status: "error", message: "Note content cannot be empty" };
      }
      const fileState = get().files[filePath];
      const task = fileState.data.tasks.find((t) => t.id === taskId);
      if (!task) return { status: "error", message: "Task not found" };

      const note = createNote(content, actionability);
      set((state) => {
        const f = state.files[filePath];
        if (!f) return state;
        const current = f.data.tasks.find((t) => t.id === taskId);
        if (!current) return state;
        return {
          files: {
            ...state.files,
            [filePath]: { data: { ...f.data, tasks: replaceTask(f.data.tasks, addNote(current, note)) } },
          },
        };
      });
      return flush(filePath);
    },

    removeNote: async (filePath, taskId, noteId) => {
      const fileState = get().files[filePath];
      if (!fileState) return { status: "error", message: "File not loaded" };
      const task = fileState.data.tasks.find((t) => t.id === taskId);
      if (!task) return { status: "error", message: "Task not found" };

      const updated = deleteNote(task, noteId);
      if (updated === task) return { status: "success" };

      set((state) => {
        const f = state.files[filePath];
        if (!f) return state;
        const current = f.data.tasks.find((t) => t.id === taskId);
        if (!current) return state;
        const next = deleteNote(current, noteId);
        if (next === current) return state;
        return {
          files: {
            ...state.files,
            [filePath]: { data: { ...f.data, tasks: replaceTask(f.data.tasks, next) } },
          },
        };
      });
      return flush(filePath);
    },

    updateNote: async (filePath, taskId, noteId, content) => {
      const fileState = get().files[filePath];
      if (!fileState) return { status: "error", message: "File not loaded" };
      if (!content.trim()) {
        return { status: "error", message: "Note content cannot be empty" };
      }
      const task = fileState.data.tasks.find((t) => t.id === taskId);
      if (!task) return { status: "error", message: "Task not found" };

      const updated = updateNoteContent(task, noteId, content);
      if (updated === task) return { status: "success" };

      set((state) => {
        const f = state.files[filePath];
        if (!f) return state;
        const current = f.data.tasks.find((t) => t.id === taskId);
        if (!current) return state;
        const next = updateNoteContent(current, noteId, content);
        if (next === current) return state;
        return {
          files: {
            ...state.files,
            [filePath]: { data: { ...f.data, tasks: replaceTask(f.data.tasks, next) } },
          },
        };
      });
      return flush(filePath);
    },

    setNoteActionability: async (filePath, taskId, noteId, actionability) => {
      const fileState = get().files[filePath];
      if (!fileState) return { status: "error", message: "File not loaded" };
      const task = fileState.data.tasks.find((t) => t.id === taskId);
      if (!task) return { status: "error", message: "Task not found" };

      const updated = changeNoteActionability(task, noteId, actionability);
      if (updated === task) return { status: "success" };

      set((state) => {
        const f = state.files[filePath];
        if (!f) return state;
        const current = f.data.tasks.find((t) => t.id === taskId);
        if (!current) return state;
        const next = changeNoteActionability(current, noteId, actionability);
        if (next === current) return state;
        return {
          files: {
            ...state.files,
            [filePath]: { data: { ...f.data, tasks: replaceTask(f.data.tasks, next) } },
          },
        };
      });
      return flush(filePath);
    },

    // --- Reorder operations (use the current selection) ---

    kick: async (filePath, distance) => {
      const fileState = get().files[filePath];
      if (!fileState) return { status: "error", message: "File not loaded" };
      const selectedTaskIds = selectedTaskIdsForFile(get().selectedKeys, filePath);
      if (selectedTaskIds.size === 0) {
        return { status: "error", message: "No tasks selected" };
      }
      const prefs = usePreferencesStore.getState().preferences;
      const newTasks = kickTasks(
        fileState.data.tasks,
        selectedTaskIds,
        distance,
        prefs.timezone,
        prefs.dueSoonDays,
      );
      if (newTasks === fileState.data.tasks) return { status: "success" };

      set((state) => {
        const f = state.files[filePath];
        if (!f) return state;
        const ids = selectedTaskIdsForFile(state.selectedKeys, filePath);
        if (ids.size === 0) return state;
        const next = kickTasks(
          f.data.tasks,
          ids,
          distance,
          prefs.timezone,
          prefs.dueSoonDays,
        );
        if (next === f.data.tasks) return state;
        return {
          files: {
            ...state.files,
            [filePath]: { data: { ...f.data, tasks: next } },
          },
          reorderTick: state.reorderTick + 1,
        };
      });
      return flush(filePath);
    },

    sendToFirst: async (filePath) => {
      const fileState = get().files[filePath];
      if (!fileState) return { status: "error", message: "File not loaded" };
      const selectedTaskIds = selectedTaskIdsForFile(get().selectedKeys, filePath);
      if (selectedTaskIds.size === 0) {
        return { status: "error", message: "No tasks selected" };
      }
      const prefs = usePreferencesStore.getState().preferences;
      const newTasks = sendTasksToFirst(
        fileState.data.tasks,
        selectedTaskIds,
        prefs.timezone,
        prefs.dueSoonDays,
      );
      if (newTasks === fileState.data.tasks) return { status: "success" };

      set((state) => {
        const f = state.files[filePath];
        if (!f) return state;
        const ids = selectedTaskIdsForFile(state.selectedKeys, filePath);
        if (ids.size === 0) return state;
        const next = sendTasksToFirst(
          f.data.tasks,
          ids,
          prefs.timezone,
          prefs.dueSoonDays,
        );
        if (next === f.data.tasks) return state;
        return {
          files: {
            ...state.files,
            [filePath]: { data: { ...f.data, tasks: next } },
          },
          reorderTick: state.reorderTick + 1,
        };
      });
      return flush(filePath);
    },

    sendToLast: async (filePath) => {
      const fileState = get().files[filePath];
      if (!fileState) return { status: "error", message: "File not loaded" };
      const selectedTaskIds = selectedTaskIdsForFile(get().selectedKeys, filePath);
      if (selectedTaskIds.size === 0) {
        return { status: "error", message: "No tasks selected" };
      }
      const prefs = usePreferencesStore.getState().preferences;
      const newTasks = sendTasksToLast(
        fileState.data.tasks,
        selectedTaskIds,
        prefs.timezone,
        prefs.dueSoonDays,
      );
      if (newTasks === fileState.data.tasks) return { status: "success" };

      set((state) => {
        const f = state.files[filePath];
        if (!f) return state;
        const ids = selectedTaskIdsForFile(state.selectedKeys, filePath);
        if (ids.size === 0) return state;
        const next = sendTasksToLast(
          f.data.tasks,
          ids,
          prefs.timezone,
          prefs.dueSoonDays,
        );
        if (next === f.data.tasks) return state;
        return {
          files: {
            ...state.files,
            [filePath]: { data: { ...f.data, tasks: next } },
          },
          reorderTick: state.reorderTick + 1,
        };
      });
      return flush(filePath);
    },

    moveUp: async (filePath) => {
      const fileState = get().files[filePath];
      if (!fileState) return { status: "error", message: "File not loaded" };
      const selectedTaskIds = selectedTaskIdsForFile(get().selectedKeys, filePath);
      if (selectedTaskIds.size === 0) {
        return { status: "error", message: "No tasks selected" };
      }
      const prefs = usePreferencesStore.getState().preferences;
      const newTasks = moveTasksUp(
        fileState.data.tasks,
        selectedTaskIds,
        prefs.timezone,
        prefs.dueSoonDays,
      );
      if (newTasks === fileState.data.tasks) return { status: "success" };

      set((state) => {
        const f = state.files[filePath];
        if (!f) return state;
        const ids = selectedTaskIdsForFile(state.selectedKeys, filePath);
        if (ids.size === 0) return state;
        const next = moveTasksUp(
          f.data.tasks,
          ids,
          prefs.timezone,
          prefs.dueSoonDays,
        );
        if (next === f.data.tasks) return state;
        return {
          files: {
            ...state.files,
            [filePath]: { data: { ...f.data, tasks: next } },
          },
          reorderTick: state.reorderTick + 1,
        };
      });
      return flush(filePath);
    },

    moveDown: async (filePath) => {
      const fileState = get().files[filePath];
      if (!fileState) return { status: "error", message: "File not loaded" };
      const selectedTaskIds = selectedTaskIdsForFile(get().selectedKeys, filePath);
      if (selectedTaskIds.size === 0) {
        return { status: "error", message: "No tasks selected" };
      }
      const prefs = usePreferencesStore.getState().preferences;
      const newTasks = moveTasksDown(
        fileState.data.tasks,
        selectedTaskIds,
        prefs.timezone,
        prefs.dueSoonDays,
      );
      if (newTasks === fileState.data.tasks) return { status: "success" };

      set((state) => {
        const f = state.files[filePath];
        if (!f) return state;
        const ids = selectedTaskIdsForFile(state.selectedKeys, filePath);
        if (ids.size === 0) return state;
        const next = moveTasksDown(
          f.data.tasks,
          ids,
          prefs.timezone,
          prefs.dueSoonDays,
        );
        if (next === f.data.tasks) return state;
        return {
          files: {
            ...state.files,
            [filePath]: { data: { ...f.data, tasks: next } },
          },
          reorderTick: state.reorderTick + 1,
        };
      });
      return flush(filePath);
    },

    dropkick: async (filePath) => {
      const fileState = get().files[filePath];
      if (!fileState) return { status: "error", message: "File not loaded" };
      const selectedTaskIds = selectedTaskIdsForFile(get().selectedKeys, filePath);
      if (selectedTaskIds.size === 0) {
        return { status: "error", message: "No tasks selected" };
      }
      const prefs = usePreferencesStore.getState().preferences;
      const newTasks = dropkickTasks(
        fileState.data.tasks,
        selectedTaskIds,
        prefs.timezone,
        prefs.dueSoonDays,
      );
      if (newTasks === fileState.data.tasks) return { status: "success" };

      set((state) => {
        const f = state.files[filePath];
        if (!f) return state;
        const ids = selectedTaskIdsForFile(state.selectedKeys, filePath);
        if (ids.size === 0) return state;
        const next = dropkickTasks(
          f.data.tasks,
          ids,
          prefs.timezone,
          prefs.dueSoonDays,
        );
        if (next === f.data.tasks) return state;
        return {
          files: {
            ...state.files,
            [filePath]: { data: { ...f.data, tasks: next } },
          },
        };
      });
      return flush(filePath);
    },

    // --- Two-file move ---
    //
    // Unlike single-file actions, the move does NOT mutate state synchronously.
    // The repository holds both files' serial slots, recomputes the move from
    // the latest store data inside those slots, and writes both files
    // transactionally with rollback. The store applies the result on success.

    moveTasks: async (sourceFilePath, destFilePath, taskIds) => {
      if (sourceFilePath === destFilePath) {
        return {
          status: "error",
          message: "Source and destination must be different",
        };
      }

      const result = await flushMove(sourceFilePath, destFilePath, (): MoveInputs | null => {
        const sourceState = get().files[sourceFilePath];
        const destState = get().files[destFilePath];
        if (!sourceState || !destState) return null;
        const moveResult = prepareMoveOperation(
          sourceState.data.tasks,
          destState.data.tasks,
          taskIds,
        );
        return {
          sourceDataPreMove: sourceState.data,
          destDataPreMove: destState.data,
          sourceTasksPostMove: moveResult.sourceTasks,
          destTasksPostMove: moveResult.destinationTasks,
        };
      });

      if (result.status === "success") {
        set((state) => ({
          files: {
            ...state.files,
            [sourceFilePath]: { data: result.sourceData },
            [destFilePath]: { data: result.destData },
          },
          selectedKeys: new Set(),
        }));
        return { status: "success" };
      }

      const message =
        result.status === "dest-conflict"
          ? "The destination file was modified outside Dropkick. No tasks were moved."
          : result.status === "dest-deleted"
            ? "The destination file no longer exists. No tasks were moved."
            : result.status === "source-conflict"
              ? "The source file was modified outside Dropkick. The destination was restored, so no tasks were moved."
              : result.status === "source-deleted"
                ? "The source file no longer exists. The destination was restored, so no tasks were moved."
                : result.message;

      return { status: "error", message };
    },

    // --- Conflict resolution ---

    forceWrite: async (filePath: string) => {
      const fileState = get().files[filePath];
      if (!fileState) return;
      await forceFlushTaskList(filePath, fileState.data);
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
          [filePath]: { data: loaded.taskList.data },
        },
        fileLoadErrors: removeRecordKey(state.fileLoadErrors, filePath),
        selectedKeys: new Set(),
      }));
    },
  };
});

// Re-export the discriminated unions used by `WriteResult` so callers don't
// need to import from the repository directly.
export type { WriteResult };
