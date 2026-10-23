// TaskListStore — holds all loaded task list data in a map keyed by file path.
// Open lists are loaded eagerly and kept until their tab or workspace departs.
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
import { message, type Message } from "../i18n/translate";
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
  RefreshResult,
} from "../repositories";
import {
  loadTaskList,
  createTaskListFile,
  flushTaskList,
  flushMove,
  forgetTaskList,
  refreshTaskList,
  log,
  loadFailureFields,
  drainRequiredSerial,
  pendingSerialKeys,
} from "../repositories";
import { createTask, createNote, parseTaskKey, retainSelection } from "../utils";
import type { CreateTaskOptions } from "../utils";
import { usePreferencesStore } from "./preferences-store";
import { useNoteDraftStore } from "./note-draft-store";
import { holdsDraftFor } from "../services/note-drafts";
import { markTaskListEdit, retainLaterTaskList, settleTaskMove } from "../services/task-list-settlement";
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
  describeDiskFailure,
  type LoadFailure,
} from "../services";

// Per-file loaded state. The repository owns the hash; the store holds data.
interface FileState {
  data: TaskListDto;
}

type LoadFileResult = { status: "success" } | { status: "cancelled" } | LoadFailure;

type FileLoadError = LoadFailure;


export type TaskFieldChange =
  | { field: "status"; value: TaskStatus }
  | { field: "priority"; value: TaskPriority }
  | { field: "dueDate"; value: string | null };

interface TaskListState {
  // Map of file path → loaded task list data.
  files: Record<string, FileState>;

  // Map of file path → latest failed load result.
  fileLoadErrors: Record<string, FileLoadError>;

  // Map of file path → why a loaded list's file, changed on disk, could not be
  // read back. The loaded copy stays in `files` and on screen; the entry goes
  // once the file reads back or is saved again.
  fileDiskErrors: Record<string, FileLoadError>;

  // Map of file path → why the list's latest changes are not on disk. A failed
  // save keeps the edit on screen rather than reverting it; the list stays
  // unsaved, with this reason and a Retry, until a save of it lands.
  unsavedFiles: Record<string, Message>;

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
  ownedFilePaths: () => string[];

  // Actions: selection.
  setSelection: (keys: Set<string>) => void;
  clearSelection: () => void;

  // Actions: handled tasks pagination.
  showMoreHandled: (viewKey: string, pageSize: number) => void;
  setHandledExpanded: (viewKey: string, expanded: boolean) => void;

  // Bulk fields validate per task but publish each changed source list once.
  updateTaskFields: (tasks: readonly { sourceFile: string; id: string }[], change: TaskFieldChange) => Promise<ActionResult[]>;

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
    editedAtUtc?: string,
  ) => Promise<ActionResult>;
  updateDescription: (
    filePath: string,
    taskId: string,
    description: string,
    editedAtUtc?: string,
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
    editedAtUtc?: string,
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
    editedAtUtc?: string,
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
  ) => Promise<{ status: "success" } | { status: "error"; message: Message }>;

  // The lists whose latest changes are not on disk, and the way to save them
  // again: Retry writes each named list's current copy (all unsaved lists when
  // none are named).
  unsavedPaths: () => string[];
  retryUnsaved: (paths?: readonly string[]) => void;

  // Picks up a loaded list's file when it changed on disk, called as the user
  // returns to the list. A list the app holds edits for (a write still on its
  // way, an unsaved change, or a draft for one of its tasks) keeps the loaded
  // copy, and its next save meets the conflict dialog.
  refreshFromDisk: (filePath: string) => Promise<void>;
}

function loadResultToStoreResult(result: LoadTaskListResult | FileLoadError): LoadFileResult {
  if (result.status === "success") return { status: "success" };
  return result;
}

// loadTaskList returns explicit results for known failures, but the underlying
// backend read can also reject outright (IPC / serialization error). Convert a
// throw into an error result so callers always record it in fileLoadErrors and
// surface it inline — load actions never reject.
async function safeLoadTaskList(filePath: string, onLoaded?: (data: TaskListDto) => void): Promise<LoadTaskListResult> {
  try {
    return await loadTaskList(filePath, onLoaded);
  } catch (e) {
    return {
      status: "error",
      message: "The task list could not be read. Check that it is still available and that Dropkick has access, then try again.",
    };
  }
}

// A list is one entity wherever its file is, so a file carrying the id of a
// list already open from another file (a Finder or Explorer copy) is refused
// with both paths named, never opened beside it; ids are never reassigned.
function duplicateOf(
  files: Record<string, FileState>,
  data: TaskListDto,
  path: string,
): FileLoadError | null {
  for (const [otherPath, file] of Object.entries(files)) {
    if (otherPath !== path && file.data.id === data.id) {
      return { status: "duplicate", path, otherPath };
    }
  }
  return null;
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
  // Admission starts before a reopening request waits on old physical work.
  // A second workspace departure must also revoke that waiting successor.
  const loadAdmissions = new Map<string, object>();
  // Optional reads own one active admission and one latest invalidation. A
  // successor joins the serial queue only after settlement, behind saves
  // already accepted while the read was held.
  const refreshes = new Map<string, { pending: boolean; promise: Promise<void> }>();

  // The number of writes still queued or running per file. A list with one
  // keeps its loaded copy when the disk changes (refreshFromDisk).
  const pendingWrites = new Map<string, number>();
  const inFlightUnloads = new Map<string, Promise<void>>();

  function beginPendingWrite(filePath: string): void {
    pendingWrites.set(filePath, (pendingWrites.get(filePath) ?? 0) + 1);
  }

  function endPendingWrite(filePath: string): void {
    const remaining = (pendingWrites.get(filePath) ?? 1) - 1;
    if (remaining <= 0) pendingWrites.delete(filePath);
    else pendingWrites.set(filePath, remaining);
  }

  // The edit stays in memory and on screen; the list waits for a save that
  // lands (a later edit or Retry), and quit and closing its tab ask about it.
  function markUnsaved(filePath: string, reason: Message): void {
    if (!get().files[filePath]) return;
    set((state) => ({ unsavedFiles: { ...state.unsavedFiles, [filePath]: reason } }));
  }

  function clearUnsaved(filePath: string): void {
    if (!get().unsavedFiles[filePath]) return;
    set((state) => ({ unsavedFiles: removeRecordKey(state.unsavedFiles, filePath) }));
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
        selectedKeys: retainSelection(state.selectedKeys, filePath, new Set(data.tasks.map((task) => task.id))),
      };
    });
  }

  // A save or a read that lands proves the file is there and readable again.
  function clearDiskError(filePath: string): void {
    if (!get().fileDiskErrors[filePath]) return;
    set((state) => ({ fileDiskErrors: removeRecordKey(state.fileDiskErrors, filePath) }));
  }

  // Helper: queue a flush for the given file and translate the repository's
  // WriteResult into an ActionResult. If the disk was modified outside
  // Dropkick and the user chose Reload, the reloaded data is applied to the
  // store here so the UI reflects the disk state. A write that does not land
  // leaves the edit in place and the list unsaved; the action itself reports
  // success, because the change is accepted and the list's own result (with
  // Retry) is the one place the failure is presented.
  async function flush(
    filePath: string,
    action: string,
    fields: LogFields = {},
  ): Promise<ActionResult> {
    // One info line per user-initiated mutation, logged here because every
    // mutating action funnels through this flush. No-op actions return before
    // reaching this point, so unchanged edits are not logged.
    log.info(action, { file: filePath, ...fields });
    // The write can reject outright — a failed atomic rename, a full disk, an
    // unmounted volume, an IPC error; the write boundary has already logged
    // the cause.
    let result: WriteResult;
    let writtenData: TaskListDto | null = null;
    let reloadSettled = false;
    try {
      result = await flushTaskList(filePath, () => {
        const f = get().files[filePath];
        if (!f) {
          throw new Error(`File not loaded: ${filePath}`);
        }
        writtenData = f.data;
        return f.data;
      }, (data) => {
        if (duplicateOf(get().files, data, filePath)) return false;
        const current = get().files[filePath]?.data;
        const retained = writtenData && current ? retainLaterTaskList(writtenData, current, data) : data;
        endPendingWrite(filePath);
        clearUnsaved(filePath);
        applyData(filePath, retained);
        reloadSettled = true;
        if (retained !== data && !pendingWrites.has(filePath)) {
          beginPendingWrite(filePath);
          void flush(filePath, action, fields);
        }
        return true;
      });
    } catch {
      endPendingWrite(filePath);
      markUnsaved(filePath, message("write.taskList"));
      return { status: "success" };
    }

    if (result.status === "covered") {
      // The covering caller has already applied the save/reload outcome. In
      // particular, never replay its reload over edits accepted since then.
      endPendingWrite(filePath);
      return { status: "success" };
    }
    if (result.status === "success") {
      endPendingWrite(filePath);
      clearUnsaved(filePath);
      clearDiskError(filePath);
      return { status: "success" };
    }
    if (result.status === "error") {
      endPendingWrite(filePath);
      markUnsaved(filePath, result.message);
      return { status: "success" };
    }
    // reloaded
    const duplicate = duplicateOf(get().files, result.data, filePath);
    if (duplicate) {
      log.warn("task list reload refused", loadFailureFields(filePath, duplicate));
      endPendingWrite(filePath);
      markUnsaved(filePath, describeDiskFailure(duplicate));
      return { status: "success" };
    }
    if (!reloadSettled) {
      endPendingWrite(filePath);
      clearUnsaved(filePath);
      applyData(filePath, result.data);
    }
    return { status: "reloaded", message: result.message };
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
      const data = { ...f.data, tasks };
      markTaskListEdit(f.data, data);
      return {
        files: {
          ...state.files,
          [filePath]: { data },
        },
        ...(options.selection
          ? { selectedKeys: options.selection(state.selectedKeys) }
          : {}),
        ...(options.bumpReorderTick
          ? { reorderTick: state.reorderTick + 1 }
          : {}),
      };
    });
    if (!loaded) return { status: "error", message: message("task.fileNotLoaded") };
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
        failure = { status: "error", message: message("task.notFound") };
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
      timezone: string,
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
      ? { status: "error", message: message("task.noneSelected") }
      : result;
  }

  async function refreshOnce(filePath: string, isCurrent: () => boolean): Promise<void> {
    let result: RefreshResult | FileLoadError;
    let duplicate: FileLoadError | null = null;
    try {
      result = await refreshTaskList(filePath, (data) => {
        const current = get().files[filePath];
        if (!isCurrent() || !current || inFlightUnloads.has(filePath)) return false;
        if (pendingWrites.has(filePath)) return false;
        if (get().unsavedFiles[filePath]) return false;
        if (holdsDraftFor(useNoteDraftStore.getState().drafts, current.data.tasks, filePath)) {
          return false;
        }
        duplicate = duplicateOf(get().files, data, filePath);
        if (duplicate) return false;
        applyData(filePath, data);
        return true;
      });
    } catch (e) {
      result = { status: "error", message: e instanceof Error ? e.message : String(e) };
    }
    if (!isCurrent() || !get().files[filePath] || inFlightUnloads.has(filePath)) return;
    if (duplicate) result = duplicate;
    switch (result.status) {
      case "notLoaded":
        return;
      case "unchanged":
        clearDiskError(filePath);
        return;
      case "reloaded":
        log.info("task list reloaded from disk", {
          path: filePath,
          tasks: get().files[filePath]?.data.tasks.length ?? 0,
        });
        clearDiskError(filePath);
        return;
      case "kept":
        log.info("task list changed on disk; kept the copy with unsaved edits", {
          path: filePath,
        });
        clearDiskError(filePath);
        return;
      default: {
        const failure = result;
        log.warn("task list changed on disk and could not be read", loadFailureFields(filePath, failure));
        if (!get().files[filePath]) return;
        set((state) => ({
          fileDiskErrors: { ...state.fileDiskErrors, [filePath]: failure },
        }));
      }
    }
  }

  return {
    files: {},
    fileLoadErrors: {},
    fileDiskErrors: {},
    unsavedFiles: {},
    selectedKeys: new Set(),
    handledVisible: {},
    handledExpanded: {},
    reorderTick: 0,

    // --- File management ---

    loadFile: async (filePath: string) => {
      const admission = loadAdmissions.get(filePath) ?? {};
      loadAdmissions.set(filePath, admission);
      // A reopened tab belongs to the next lifetime, after the previous one
      // has finished its writes and released its comparison hash.
      const retiring = inFlightUnloads.get(filePath);
      if (retiring) await retiring;
      if (loadAdmissions.get(filePath) !== admission) return { status: "cancelled" };
      if (get().files[filePath]) {
        loadAdmissions.delete(filePath);
        return { status: "success" };
      }

      const existing = inFlightLoads.get(filePath);
      if (existing) return existing;

      const load = (async (): Promise<LoadFileResult> => {
        const read = await safeLoadTaskList(filePath);
        if (loadAdmissions.get(filePath) !== admission) return { status: "cancelled" };
        const loaded =
          read.status === "success"
            ? (duplicateOf(get().files, read.taskList.data, filePath) ?? read)
            : read;
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
        return { status: "success" };
      })();

      inFlightLoads.set(filePath, load);
      try {
        return await load;
      } finally {
        inFlightLoads.delete(filePath);
        if (loadAdmissions.get(filePath) === admission) loadAdmissions.delete(filePath);
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
    },

    unloadFile: async (filePath: string) => {
      refreshes.delete(filePath);
      loadAdmissions.delete(filePath);
      const existing = inFlightUnloads.get(filePath);
      if (existing) return existing;
      const mustSave = pendingWrites.has(filePath) || pendingSerialKeys().includes(filePath);
      const retire = () => {
        const closing = get().files[filePath];
        if (closing) useNoteDraftStore.getState().rememberTasks(closing.data, filePath);
        pendingWrites.delete(filePath);
        set((state) => ({
          files: removeRecordKey(state.files, filePath),
          fileLoadErrors: removeRecordKey(state.fileLoadErrors, filePath),
          fileDiskErrors: removeRecordKey(state.fileDiskErrors, filePath),
          unsavedFiles: removeRecordKey(state.unsavedFiles, filePath),
          handledVisible: removeRecordKey(state.handledVisible, filePath),
          handledExpanded: removeRecordKey(state.handledExpanded, filePath),
        }));
        log.debug("task list unloaded", { path: filePath });
      };
      const unload = Promise.resolve().then(async () => {
        if (mustSave) { await drainRequiredSerial(filePath); retire(); }
        await inFlightLoads.get(filePath);
        // Logical admission ends before unrelated reads finish. The physical
        // reservation/hash remains owned until settlement; reopening waits.
        await forgetTaskList(filePath);
      });
      inFlightUnloads.set(filePath, unload);
      if (!mustSave) retire();
      try { await unload; } finally { inFlightUnloads.delete(filePath); }
    },

    ownedFilePaths: () => [...new Set([...Object.keys(get().files), ...Object.keys(get().fileLoadErrors), ...loadAdmissions.keys()])],

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
      // Selection follows the accepted deletion once its write settles (a
      // failed write keeps the deletion and leaves the list unsaved). Filter
      // against the latest selection so a choice made while the write was
      // pending is never replaced wholesale.
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

    updateTitle: async (filePath, taskId, title, editedAtUtc) =>
      mutateTask(filePath, taskId, "update task title", { taskId }, (task) =>
        updateTaskTitle(task, title, editedAtUtc),
      ),

    updateDescription: async (filePath, taskId, description, editedAtUtc) =>
      mutateTask(
        filePath,
        taskId,
        "update task description",
        { taskId },
        (task) => updateTaskDescription(task, description, editedAtUtc),
      ),

    updateTaskFields: async (selected, change) => {
      const results: (ActionResult | undefined)[] = new Array(selected.length);
      const byFile = new Map<string, Map<string, number[]>>();
      selected.forEach((task, index) => {
        let ids = byFile.get(task.sourceFile);
        if (!ids) { ids = new Map(); byFile.set(task.sourceFile, ids); }
        ids.set(task.id, [...ids.get(task.id) ?? [], index]);
      });
      await Promise.all([...byFile].map(async ([path, ids]) => {
        const changedIndices = new Set<number>();
        const result = await mutateTasks(path, `set task ${change.field}`, { count: ids.size, value: change.value }, (tasks) => {
          let changed = false;
          const next = tasks.map((task) => {
            const indices = ids.get(task.id);
            if (!indices) return task;
            if (change.field === "status" && task.status !== change.value) {
              const validation = canTransitionStatus(task, change.value);
              if (!validation.valid) {
                for (const index of indices) results[index] = { status: "validation", reason: validation.reason! };
                return task;
              }
            }
            const updated = change.field === "status" ? changeTaskStatus(task, change.value)
              : change.field === "priority" ? changeTaskPriority(task, change.value)
              : changeTaskDueDate(task, change.value);
            for (const index of indices) {
              results[index] = { status: "success", changed: updated !== task };
              if (updated !== task) changedIndices.add(index);
            }
            changed ||= updated !== task;
            return updated;
          });
          return changed ? next : tasks;
        });
        for (const indices of ids.values()) for (const index of indices) {
          if (!results[index]) results[index] = result.status === "error" ? result : { status: "error", message: message("task.notFound") };
          else if (changedIndices.has(index)) results[index] = result;
        }
      }));
      return results as ActionResult[];
    },

    setStatus: async (sourceFile, id, value) =>
      (await get().updateTaskFields([{ sourceFile, id }], { field: "status", value }))[0],
    setPriority: async (sourceFile, id, value) =>
      (await get().updateTaskFields([{ sourceFile, id }], { field: "priority", value }))[0],
    setDueDate: async (sourceFile, id, value) =>
      (await get().updateTaskFields([{ sourceFile, id }], { field: "dueDate", value }))[0],

    addNewNote: async (filePath, taskId, content, actionability = "Informational", editedAtUtc) => {
      if (!content.trim()) {
        return { status: "error", message: message("note.empty") };
      }
      const note = createNote(content, actionability, editedAtUtc);
      return mutateTask(
        filePath,
        taskId,
        "add note",
        { taskId, noteId: note.id },
        (task) => addNote(task, note, note.createdAtUtc),
      );
    },

    removeNote: async (filePath, taskId, noteId) =>
      mutateTask(filePath, taskId, "delete note", { taskId, noteId }, (task) =>
        deleteNote(task, noteId),
      ),

    updateNote: async (filePath, taskId, noteId, content, editedAtUtc) => {
      if (!content.trim()) {
        return { status: "error", message: message("note.empty") };
      }
      return mutateTask(
        filePath,
        taskId,
        "update note",
        { taskId, noteId },
        (task) => updateNoteContent(task, noteId, content, editedAtUtc),
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
    // destination first, rolling back only after a genuine source-write failure.
    // Interruption can leave readable copies in both files.

    moveTasks: async (sourceFilePath, destFilePath, taskIds) => {
      if (sourceFilePath === destFilePath) {
        return {
          status: "error",
          message: message("move.sameFile"),
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
      let identityCollision = false;
      try {
        result = await flushMove(sourceFilePath, destFilePath, (): MoveInputs | null => {
          const sourceState = get().files[sourceFilePath];
          const destState = get().files[destFilePath];
          if (!sourceState || !destState) return null;
          if (holdsDraftFor(useNoteDraftStore.getState().drafts,
            sourceState.data.tasks.filter((task) => taskIds.has(task.id)), destFilePath)) {
            identityCollision = true;
            return null;
          }
          const moveResult = prepareMoveOperation(
            sourceState.data.tasks,
            destState.data.tasks,
            taskIds,
          );
          if (moveResult === null) { identityCollision = true; return null; }
          return {
            sourceDataPreMove: sourceState.data,
            destDataPreMove: destState.data,
            sourceTasksPostMove: moveResult.sourceTasks,
            destTasksPostMove: moveResult.destinationTasks,
            onSaved: (sourceData, destData) => {
              const source = get().files[sourceFilePath]?.data;
              const destination = get().files[destFilePath]?.data;
              if (!source || !destination) return;
              const settled = settleTaskMove(
                sourceState.data, destState.data, source, destination, sourceData, destData,
              );
              set((state) => ({ files: {
                ...state.files,
                [sourceFilePath]: { data: settled.sourceData },
                [destFilePath]: { data: settled.destData },
              }, selectedKeys: new Set() }));
              const surviving = new Set(settled.destData.tasks.map((task) => task.id));
              for (const id of taskIds) if (!surviving.has(id)) useNoteDraftStore.getState().clearTaskDrafts(id, sourceFilePath);
              useNoteDraftStore.getState().moveTaskDrafts(taskIds, sourceFilePath, destFilePath);
              // Both writes carried the store's whole copy of each list, so a
              // list left unsaved by an earlier failure is saved now.
              clearUnsaved(sourceFilePath);
              clearUnsaved(destFilePath);
              for (const [path, retained, saved] of [
                [sourceFilePath, settled.sourceData, sourceData],
                [destFilePath, settled.destData, destData],
              ] as const) {
                if (retained !== saved) {
                  beginPendingWrite(path);
                  void flush(path, "save edits made during task move");
                }
              }
            },
          };
        });
      } catch {
        // Nothing moved in memory, so the move dialog's Move is its Retry.
        return {
          status: "error",
          message: message("move.failed"),
        };
      }

      if (result.status === "success") {
        return { status: "success" };
      }

      // The destination still holds the moved tasks on disk while the screen
      // shows them only in the source. Marking it unsaved lets its Retry, its
      // next save, and the quit and tab-close questions write the screen copy
      // back, so a failed move still changes nothing.
      if (result.status === "dest-unsaved") {
        markUnsaved(destFilePath, message("write.taskList"));
      }

      const failure =
        identityCollision ? message("move.identityCollision") :
        result.status === "dest-conflict"
          ? message("move.destConflict")
          : result.status === "dest-deleted"
            ? message("move.destDeleted")
            : result.status === "source-conflict"
              ? message("move.sourceConflict")
              : result.status === "source-deleted"
                ? message("move.sourceDeleted")
                : result.status === "dest-unsaved"
                  ? message("move.failed")
                  : result.message;

      log.warn("move tasks failed", {
        source: sourceFilePath,
        dest: destFilePath,
        status: result.status,
        reason: failure.key,
      });
      return { status: "error", message: failure };
    },

    unsavedPaths: () => Object.keys(get().unsavedFiles),

    retryUnsaved: (paths) => {
      for (const filePath of paths ?? Object.keys(get().unsavedFiles)) {
        if (!get().unsavedFiles[filePath] || !get().files[filePath]) continue;
        beginPendingWrite(filePath);
        void flush(filePath, "retry save");
      }
    },

    refreshFromDisk: (filePath: string) => {
      if (!get().files[filePath] || inFlightUnloads.has(filePath)) return Promise.resolve();
      const active = refreshes.get(filePath);
      if (active) {
        active.pending = true;
        return active.promise;
      }
      const entry = { pending: true, promise: Promise.resolve() };
      refreshes.set(filePath, entry);
      const isCurrent = () => refreshes.get(filePath) === entry;
      entry.promise = (async () => {
        try {
          do {
            entry.pending = false;
            await refreshOnce(filePath, isCurrent);
          } while (entry.pending && isCurrent() && get().files[filePath] && !inFlightUnloads.has(filePath));
        } finally {
          if (isCurrent()) refreshes.delete(filePath);
        }
      })();
      return entry.promise;
    },
  };
});

// Re-export the discriminated unions used by `WriteResult` so callers don't
// need to import from the repository directly.
export type { WriteResult };
