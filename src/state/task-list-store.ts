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
import type { ActionResult } from "./action-result";
import type {
  TaskListDto,
  TaskDto,
  NoteActionability,
  TaskStatus,
  TaskPriority,
} from "../models";
import type {
  LoadTaskListResult,
  WriteResult,
  MoveResult,
  MoveInputs,
  LogFields,
} from "../repositories";
import {
  loadTaskList,
  createTaskListFile,
  flushTaskList,
  forceFlushTaskList,
  flushMove,
  forgetTaskList,
  log,
  loadFailureFields,
} from "../repositories";
import { createTask, createNote, parseTaskKey } from "../utils";
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
  deleteTasks,
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
  removeTasks: (
    filePath: string,
    taskIds: ReadonlySet<string>,
  ) => Promise<ActionResult>;
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

// loadTaskList returns explicit results for known failures, but the underlying
// backend read can also reject outright (IPC / serialization error). Convert a
// throw into an error result so callers always record it in fileLoadErrors and
// surface it inline — load actions never reject.
async function safeLoadTaskList(filePath: string): Promise<LoadTaskListResult> {
  try {
    return await loadTaskList(filePath);
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
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
  // In-flight loads keyed by path. The active-tab effect and the eager
  // background-load effect (MainWindow) can both call loadFile for the same path
  // across a tab switch; without this, each would pass the not-yet-loaded guard
  // and issue a duplicate read, and a retry could race a re-fired effect. Sharing
  // one promise per path collapses concurrent loads into a single read.
  const inFlightLoads = new Map<string, Promise<LoadFileResult>>();

  // Last data confirmed on disk, plus the number of optimistic writes still
  // outstanding per file. A failed write cannot leave an optimistic delete,
  // note, or edit stranded in memory: once the last queued attempt settles
  // unsuccessfully, restore the last confirmed snapshot. If a later write is
  // still queued, let it run first — it may persist the combined latest state.
  const persistedFiles = new Map<string, TaskListDto>();
  const pendingWrites = new Map<string, number>();

  function beginPendingWrite(filePath: string): void {
    pendingWrites.set(filePath, (pendingWrites.get(filePath) ?? 0) + 1);
  }

  function finishPendingWrite(
    filePath: string,
    outcome: { persisted?: TaskListDto; failed?: boolean },
  ): void {
    if (outcome.persisted) persistedFiles.set(filePath, outcome.persisted);
    const remaining = Math.max(0, (pendingWrites.get(filePath) ?? 1) - 1);
    if (remaining === 0) pendingWrites.delete(filePath);
    else pendingWrites.set(filePath, remaining);

    if (outcome.failed && remaining === 0) {
      const persisted = persistedFiles.get(filePath);
      if (persisted) applyData(filePath, persisted);
    }
  }

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
  async function flush(
    filePath: string,
    action: string,
    fields: LogFields = {},
  ): Promise<ActionResult> {
    // One info line per user-initiated mutation, logged here because every
    // mutating action funnels through this flush. No-op actions return before
    // reaching this point, so unchanged edits are not logged.
    log.info(action, { file: filePath, ...fields });
    // flushTaskList returns explicit results for known failures, but the write
    // can also reject outright — a failed atomic rename, a full disk, an
    // unmounted volume, an IPC error. Converting a throw into an error result
    // gives mutating actions the same never-reject contract loads already have
    // via safeLoadTaskList. Without it the rejection unwound past every call
    // site (none of which catch) to the global unhandled-rejection logger,
    // while the synchronous state transition had already applied the edit — so
    // the UI showed every change saved and nothing reached disk. The write
    // boundary has already logged the cause.
    let result: WriteResult;
    let writtenData: TaskListDto | null = null;
    try {
      result = await flushTaskList(filePath, () => {
        const f = get().files[filePath];
        if (!f) {
          throw new Error(`File not loaded: ${filePath}`);
        }
        writtenData = f.data;
        return f.data;
      });
    } catch {
      finishPendingWrite(filePath, { failed: true });
      return {
        status: "error",
        message:
          "The task list could not be saved. Your change was not saved; try again.",
      };
    }

    if (result.status === "success") {
      finishPendingWrite(filePath, {
        persisted: writtenData ?? get().files[filePath]?.data,
      });
      return { status: "success" };
    }
    if (result.status === "error") {
      finishPendingWrite(filePath, { failed: true });
      return { status: "error", message: result.message };
    }
    // reloaded
    finishPendingWrite(filePath, { persisted: result.data });
    applyData(filePath, result.data);
    return { status: "error", message: result.message };
  }


  // Runs one mutation end to end: apply `transform` EXACTLY ONCE against the
  // latest state inside the synchronous transition, then flush only if it
  // changed anything. A transform signals "nothing to do" by returning its
  // input array unchanged.
  //
  // Running the operation once is the point. The earlier shape ran it twice —
  // a precheck against get(), then the same computation again inside the
  // updater — so every rule had to be written twice per action, and the two
  // copies had already drifted over whether they reported `changed`. Nothing
  // awaits between the two reads, so the second was never a different answer.
  async function mutateTasks(
    filePath: string,
    action: string,
    // Resolved after the transition, so a log line can carry a value the
    // transform computed — the selection size, which is only known once the
    // latest selection has been read.
    fields: LogFields | (() => LogFields),
    transform: (tasks: TaskDto[], state: TaskListState) => TaskDto[],
    options: {
      selection?: (prev: Set<string>) => Set<string>;
      bumpReorderTick?: boolean;
    } = {},
  ): Promise<ActionResult> {
    let loaded = true;
    let changed = false;
    set((state) => {
      const f = state.files[filePath];
      if (!f) {
        loaded = false;
        return state;
      }
      const tasks = transform(f.data.tasks, state);
      if (tasks === f.data.tasks) return state;
      changed = true;
      return {
        files: {
          ...state.files,
          [filePath]: { data: { ...f.data, tasks } },
        },
        ...(options.selection
          ? { selectedKeys: options.selection(state.selectedKeys) }
          : {}),
        ...(options.bumpReorderTick
          ? { reorderTick: state.reorderTick + 1 }
          : {}),
      };
    });
    if (!loaded) return { status: "error", message: "File not loaded" };
    if (!changed) return { status: "success", changed: false };
    beginPendingWrite(filePath);
    const result = await flush(
      filePath,
      action,
      typeof fields === "function" ? fields() : fields,
    );
    return result.status === "success"
      ? { status: "success", changed: true }
      : result;
  }

  // Task-level mutation: locate the task, optionally validate it, and replace
  // it with the transform's result. `validate` runs against the same task the
  // transform will see, inside the one transition.
  async function mutateTask(
    filePath: string,
    taskId: string,
    action: string,
    fields: LogFields,
    transform: (task: TaskDto) => TaskDto,
    validate?: (task: TaskDto) => ActionResult | null,
  ): Promise<ActionResult> {
    let failure: ActionResult | null = null;
    const result = await mutateTasks(filePath, action, fields, (tasks) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) {
        failure = { status: "error", message: "Task not found" };
        return tasks;
      }
      const invalid = validate?.(task);
      if (invalid) {
        failure = invalid;
        return tasks;
      }
      const next = transform(task);
      return next === task ? tasks : replaceTask(tasks, next);
    });
    return failure ?? result;
  }

  // Reorder mutation: every reorder acts on the current selection for this file
  // and needs the same preference-derived arguments, so the shape is shared and
  // only the reordering function differs.
  async function mutateSelectionOrder(
    filePath: string,
    action: string,
    apply: (
      tasks: TaskDto[],
      ids: Set<string>,
      timezone: string | null,
      dueSoonDays: number,
    ) => TaskDto[],
    extraFields: LogFields = {},
    bumpReorderTick = true,
  ): Promise<ActionResult> {
    let selectedCount = 0;
    let empty = false;
    const prefs = usePreferencesStore.getState().preferences;
    const result = await mutateTasks(
      filePath,
      action,
      () => ({ selected: selectedCount, ...extraFields }),
      (tasks, state) => {
        const ids = selectedTaskIdsForFile(state.selectedKeys, filePath);
        selectedCount = ids.size;
        if (ids.size === 0) {
          empty = true;
          return tasks;
        }
        return apply(tasks, ids, prefs.timezone, prefs.dueSoonDays);
      },
      { bumpReorderTick },
    );
    return empty
      ? { status: "error", message: "No tasks selected" }
      : result;
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

      const existing = inFlightLoads.get(filePath);
      if (existing) return existing;

      const load = (async (): Promise<LoadFileResult> => {
        const loaded = await safeLoadTaskList(filePath);
        if (loaded.status !== "success") {
          // Single source for load-boundary failures — covers the active tab,
          // every eagerly background-loaded tab, and opens from the tab menu.
          log.warn("task list load failed", loadFailureFields(filePath, loaded));
          set((state) => ({
            fileLoadErrors: {
              ...state.fileLoadErrors,
              [filePath]: loaded,
            },
          }));
          return loadResultToStoreResult(loaded);
        }

        log.info("task list loaded", {
          path: filePath,
          tasks: loaded.taskList.data.tasks.length,
        });
        set((state) => ({
          files: {
            ...state.files,
            [filePath]: { data: loaded.taskList.data },
          },
          fileLoadErrors: removeRecordKey(state.fileLoadErrors, filePath),
        }));
        persistedFiles.set(filePath, loaded.taskList.data);
        return { status: "success" };
      })();

      inFlightLoads.set(filePath, load);
      try {
        return await load;
      } finally {
        inFlightLoads.delete(filePath);
      }
    },

    createFile: async (filePath: string) => {
      const loaded = await createTaskListFile(filePath);
      log.info("task list created", { path: filePath });
      set((state) => ({
        files: {
          ...state.files,
          [filePath]: { data: loaded.data },
        },
        fileLoadErrors: removeRecordKey(state.fileLoadErrors, filePath),
      }));
      persistedFiles.set(filePath, loaded.data);
    },

    unloadFile: async (filePath: string) => {
      // Drain any pending writes for this path before removing the entry from
      // memory. forgetTaskList runs inside the path's serial chain, so any
      // queued flush completes (using the still-present in-memory data) before
      // the hash is dropped.
      log.debug("task list unloaded", { path: filePath });
      await forgetTaskList(filePath);
      persistedFiles.delete(filePath);
      pendingWrites.delete(filePath);
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
      const task = createTask(options);
      return mutateTasks(filePath, "add task", { taskId: task.id }, (tasks) =>
        addTask(tasks, task),
      );
    },

    removeTasks: async (filePath, taskIds) => {
      const result = await mutateTasks(
        filePath,
        "delete tasks",
        { count: taskIds.size },
        (tasks) => deleteTasks(tasks, taskIds),
      );
      // Selection follows persistence, not the optimistic task-array update.
      // A failed write restores the tasks, so it must also leave them selected
      // for retry. On success, filter against the latest selection so a choice
      // made while the write was pending is never replaced wholesale.
      if (result.status === "success" && result.changed) {
        set((state) => ({
          selectedKeys: new Set(
            [...state.selectedKeys].filter((key) => {
              const parsed = parseTaskKey(key);
              return !(
                parsed?.sourceFile === filePath && taskIds.has(parsed.taskId)
              );
            }),
          ),
        }));
      }
      return result;
    },

    updateTitle: async (filePath, taskId, title) =>
      mutateTask(filePath, taskId, "update task title", { taskId }, (task) =>
        updateTaskTitle(task, title),
      ),

    updateDescription: async (filePath, taskId, description) =>
      mutateTask(
        filePath,
        taskId,
        "update task description",
        { taskId },
        (task) => updateTaskDescription(task, description),
      ),

    setStatus: async (filePath, taskId, status) =>
      mutateTask(
        filePath,
        taskId,
        "set task status",
        { taskId, status },
        (task) => changeTaskStatus(task, status),
        // Setting the status a task already has is a no-op, not a transition,
        // so it is not validated — the transform then returns the same task and
        // nothing is written.
        (task) => {
          if (task.status === status) return null;
          const validation = canTransitionStatus(task, status);
          return validation.valid
            ? null
            : { status: "validation", reason: validation.reason! };
        },
      ),

    setPriority: async (filePath, taskId, priority) =>
      mutateTask(
        filePath,
        taskId,
        "set task priority",
        { taskId, priority },
        (task) => changeTaskPriority(task, priority),
      ),

    setDueDate: async (filePath, taskId, dueDate) =>
      mutateTask(
        filePath,
        taskId,
        "set task due date",
        { taskId, dueDate },
        (task) => changeTaskDueDate(task, dueDate),
      ),

    addNewNote: async (filePath, taskId, content, actionability = "Informational") => {
      if (!content.trim()) {
        return { status: "error", message: "Note content cannot be empty" };
      }
      const note = createNote(content, actionability);
      return mutateTask(
        filePath,
        taskId,
        "add note",
        { taskId, noteId: note.id },
        (task) => addNote(task, note),
      );
    },

    removeNote: async (filePath, taskId, noteId) =>
      mutateTask(filePath, taskId, "delete note", { taskId, noteId }, (task) =>
        deleteNote(task, noteId),
      ),

    updateNote: async (filePath, taskId, noteId, content) => {
      if (!content.trim()) {
        return { status: "error", message: "Note content cannot be empty" };
      }
      return mutateTask(
        filePath,
        taskId,
        "update note",
        { taskId, noteId },
        (task) => updateNoteContent(task, noteId, content),
      );
    },

    setNoteActionability: async (filePath, taskId, noteId, actionability) =>
      mutateTask(
        filePath,
        taskId,
        "set note actionability",
        { taskId, noteId, actionability },
        (task) => changeNoteActionability(task, noteId, actionability),
      ),

    // --- Reorder operations (use the current selection) ---

    kick: async (filePath, distance) =>
      mutateSelectionOrder(
        filePath,
        "kick tasks",
        (tasks, ids, timezone, dueSoonDays) =>
          kickTasks(tasks, ids, distance, timezone, dueSoonDays),
        { distance },
      ),

    sendToFirst: async (filePath) =>
      mutateSelectionOrder(filePath, "send tasks to first", sendTasksToFirst),

    sendToLast: async (filePath) =>
      mutateSelectionOrder(filePath, "send tasks to last", sendTasksToLast),

    moveUp: async (filePath) =>
      mutateSelectionOrder(filePath, "move tasks up", moveTasksUp),

    moveDown: async (filePath) =>
      mutateSelectionOrder(filePath, "move tasks down", moveTasksDown),

    // Dropkick deliberately does not bump reorderTick: it sends tasks to the
    // end of the list rather than repositioning them within the visible order,
    // so the list has nothing to re-anchor on.
    dropkick: async (filePath) =>
      mutateSelectionOrder(filePath, "dropkick tasks", dropkickTasks, {}, false),

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

      log.info("move tasks between files", {
        source: sourceFilePath,
        dest: destFilePath,
        count: taskIds.size,
      });

      // Same never-reject contract as flush() above: a cross-file move writes
      // two files, and a rejection here would leave the UI showing tasks in a
      // list they never reached.
      let result: MoveResult;
      try {
        result = await flushMove(sourceFilePath, destFilePath, (): MoveInputs | null => {
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
      } catch {
        return {
          status: "error",
          message:
            "The tasks could not be moved. They remain in their current lists; try again.",
        };
      }

      if (result.status === "success") {
        persistedFiles.set(sourceFilePath, result.sourceData);
        persistedFiles.set(destFilePath, result.destData);
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

      log.warn("move tasks failed", {
        source: sourceFilePath,
        dest: destFilePath,
        status: result.status,
        reason: message,
      });
      return { status: "error", message };
    },

    // --- Conflict resolution ---

    forceWrite: async (filePath: string) => {
      const fileState = get().files[filePath];
      if (!fileState) return;
      log.info("force write task list", { path: filePath });
      await forceFlushTaskList(filePath, fileState.data);
      persistedFiles.set(filePath, fileState.data);
    },

    reloadFile: async (filePath: string) => {
      log.info("reload task list", { path: filePath });
      const loaded = await safeLoadTaskList(filePath);
      if (loaded.status !== "success") {
        log.warn("task list reload failed", loadFailureFields(filePath, loaded));
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
      persistedFiles.set(filePath, loaded.taskList.data);
    },
  };
});

// Re-export the discriminated unions used by `WriteResult` so callers don't
// need to import from the repository directly.
export type { WriteResult };
