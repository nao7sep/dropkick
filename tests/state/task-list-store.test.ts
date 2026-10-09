import { inEnglish } from "../helpers/i18n";
import { message } from "../../src/i18n/translate";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MoveInputs } from "../../src/repositories/task-list-repository";
import type { TaskListDto } from "../../src/models";

// --- Repository mock ---
// The store's only side effects go through ../repositories. We mock the whole
// barrel so nothing touches the filesystem and we can assert flush behavior.

const loadTaskList = vi.fn();
const createTaskListFile = vi.fn();
const flushTaskList = vi.fn();
const flushMove = vi.fn();
const forgetTaskList = vi.fn(async (_p: string) => {});
const refreshTaskList = vi.fn();

vi.mock("../../src/repositories", () => ({
  loadTaskList: async (p: string, onLoaded?: (data: TaskListDto) => void) => {
    const result = await loadTaskList(p);
    if (result.status === "success") onLoaded?.(result.taskList.data);
    return result;
  },
  createTaskListFile: (p: string) => createTaskListFile(p),
  flushTaskList: async (p: string, getData: () => TaskListDto, onReloaded?: (data: TaskListDto) => void) => {
    const result = await flushTaskList(p, getData);
    if (result.status === "reloaded") onReloaded?.(result.data);
    return result;
  },
  flushMove: async (s: string, d: string, getInputs: () => MoveInputs | null) => {
    let inputs: MoveInputs | null = null;
    const result = await flushMove(s, d, () => { inputs = getInputs(); return inputs; });
    if (result.status === "success" && inputs) {
      (inputs as MoveInputs).onSaved?.(result.sourceData, result.destData);
    }
    return result;
  },
  forgetTaskList: (p: string) => forgetTaskList(p),
  refreshTaskList: (p: string, adopt: (data: TaskListDto) => boolean) => refreshTaskList(p, adopt),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  loadFailureFields: (path: string, result: { status: string; message?: string }) => ({
    path,
    status: result.status,
    ...(result.message !== undefined ? { error: { message: result.message } } : {}),
  }),
}));

import { useTaskListStore } from "../../src/state/task-list-store";
import { usePreferencesStore } from "../../src/state/preferences-store";
import { useNoteDraftStore } from "../../src/state/note-draft-store";
import { composerDraftKey } from "../../src/services/note-drafts";
import { makeTask, makeNote } from "../helpers/task";
import { taskKey } from "../../src/utils";
import { describeDiskFailure } from "../../src/services";

const FILE = "/list.json";

// Default flush: success, and it captures the latest data via getData().
function flushSucceeds() {
  flushTaskList.mockImplementation(async (_p: string, getData: () => TaskListDto) => {
    getData();
    return { status: "success" };
  });
}

function seedFile(tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })]) {
  useTaskListStore.setState({
    files: { [FILE]: { data: { id: "L1", tasks } } },
    fileLoadErrors: {},
    fileDiskErrors: {},
    unsavedFiles: {},
    selectedKeys: new Set(),
    handledVisible: {},
    handledExpanded: {},
  });
}

function tasksOf(file = FILE) {
  return useTaskListStore.getState().files[file]?.data.tasks ?? [];
}

beforeEach(() => {
  loadTaskList.mockReset();
  createTaskListFile.mockReset();
  flushTaskList.mockReset();
  flushMove.mockReset();
  forgetTaskList.mockClear();
  refreshTaskList.mockReset();
  useNoteDraftStore.setState({ drafts: {}, draftVersions: {} });
  flushSucceeds();
  // Reset preferences to a known timezone/window for reorder grouping.
  usePreferencesStore.setState({
    preferences: { ...usePreferencesStore.getState().preferences, timezone: "UTC", dueSoonDays: 7 },
  });
  useTaskListStore.setState({
    files: {},
    fileLoadErrors: {},
    fileDiskErrors: {},
    selectedKeys: new Set(),
    handledVisible: {},
    handledExpanded: {},
    unsavedFiles: {},
  });
});

describe("loadFile", () => {
  it("stores loaded data on success", async () => {
    loadTaskList.mockResolvedValue({
      status: "success",
      taskList: { filePath: FILE, data: { tasks: [makeTask({ id: "x" })] } },
    });
    const result = await useTaskListStore.getState().loadFile(FILE);
    expect(result).toEqual({ status: "success" });
    expect(tasksOf().map((t) => t.id)).toEqual(["x"]);
  });

  it("does not reload an already-loaded file", async () => {
    seedFile();
    const result = await useTaskListStore.getState().loadFile(FILE);
    expect(result).toEqual({ status: "success" });
    expect(loadTaskList).not.toHaveBeenCalled();
  });

  it("records a load error and surfaces it", async () => {
    loadTaskList.mockResolvedValue({ status: "missing" });
    const result = await useTaskListStore.getState().loadFile(FILE);
    expect(result).toEqual({ status: "missing" });
    expect(useTaskListStore.getState().fileLoadErrors[FILE]).toEqual({ status: "missing" });
  });

  it("records an error instead of rejecting when the read throws", async () => {
    // The backend read can reject outright (IPC failure), not just return an
    // error result. loadFile must still record it and resolve, so the failure
    // surfaces inline rather than vanishing into an unhandled rejection.
    loadTaskList.mockRejectedValue(new Error("backend boom"));
    const result = await useTaskListStore.getState().loadFile(FILE);
    expect(result).toEqual({
      status: "error",
      message:
        "The task list could not be read. Check that it is still available and that Dropkick has access, then try again.",
    });
    expect(useTaskListStore.getState().fileLoadErrors[FILE]).toEqual({
      status: "error",
      message:
        "The task list could not be read. Check that it is still available and that Dropkick has access, then try again.",
    });
  });

  it("collapses concurrent loads of the same path into a single read", async () => {
    // Hold the read open so both calls overlap before either resolves.
    let resolveRead!: (value: unknown) => void;
    loadTaskList.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );

    const first = useTaskListStore.getState().loadFile(FILE);
    const second = useTaskListStore.getState().loadFile(FILE);
    // Second call joins the in-flight load instead of issuing its own read.
    expect(loadTaskList).toHaveBeenCalledTimes(1);

    resolveRead({
      status: "success",
      taskList: { filePath: FILE, data: { tasks: [makeTask({ id: "z" })] } },
    });
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toEqual({ status: "success" });
    expect(r2).toEqual({ status: "success" });
    expect(loadTaskList).toHaveBeenCalledTimes(1);
    expect(tasksOf().map((t) => t.id)).toEqual(["z"]);
  });

  it("retries a previously errored path on a later load (in-flight entry cleared)", async () => {
    loadTaskList.mockResolvedValueOnce({ status: "missing" });
    const first = await useTaskListStore.getState().loadFile(FILE);
    expect(first).toEqual({ status: "missing" });

    // The file becomes available; because the settled load was removed from the
    // in-flight map, a later load actually re-reads rather than returning a stale
    // missing result.
    loadTaskList.mockResolvedValueOnce({
      status: "success",
      taskList: { filePath: FILE, data: { tasks: [makeTask({ id: "ok" })] } },
    });
    const second = await useTaskListStore.getState().loadFile(FILE);
    expect(second).toEqual({ status: "success" });
    expect(loadTaskList).toHaveBeenCalledTimes(2);
    expect(tasksOf().map((t) => t.id)).toEqual(["ok"]);
  });
});

describe("mutating actions — the never-reject contract", () => {
  async function loadOne(title = "before") {
    useTaskListStore.setState({ files: {} });
    loadTaskList.mockResolvedValue({
      status: "success",
      taskList: { filePath: FILE, data: { id: "L1", tasks: [makeTask({ id: "a", title })] } },
    });
    await useTaskListStore.getState().loadFile(FILE);
  }

  it("keeps the edit and leaves the list unsaved instead of rejecting when the write throws", async () => {
    // The write can reject outright — a failed atomic rename, a full disk, an
    // unmounted volume — not just return an error result. The change stays
    // accepted on screen; the list's own result says it is not on disk.
    await loadOne();
    flushTaskList.mockRejectedValue(new Error("disk full"));

    const result = await useTaskListStore.getState().updateTitle(FILE, "a", "after");

    expect(result).toEqual({ status: "success", changed: true });
    expect(tasksOf()[0].title).toBe("after");
    expect(useTaskListStore.getState().unsavedFiles[FILE]).toEqual(message("write.taskList"));
  });

  it("keeps the reason an unsuccessful save reports", async () => {
    await loadOne();
    flushTaskList.mockResolvedValue({ status: "error", message: message("write.newerOnDisk") });

    await useTaskListStore.getState().updateTitle(FILE, "a", "after");

    expect(tasksOf()[0].title).toBe("after");
    expect(useTaskListStore.getState().unsavedFiles[FILE]).toEqual(message("write.newerOnDisk"));
  });

  it("keeps a deletion whose write fails, and the selection follows it", async () => {
    await loadOne();
    flushTaskList.mockRejectedValue(new Error("disk full"));

    useTaskListStore.getState().setSelection(new Set([taskKey(FILE, "a")]));
    await useTaskListStore.getState().removeTasks(FILE, new Set(["a"]));

    expect(tasksOf()).toEqual([]);
    expect(useTaskListStore.getState().selectedKeys).toEqual(new Set());
    expect(useTaskListStore.getState().unsavedPaths()).toEqual([FILE]);
  });

  it("keeps every overlapping change when their writes fail", async () => {
    await loadOne();
    flushTaskList.mockRejectedValue(new Error("disk full"));

    await Promise.all([
      useTaskListStore.getState().updateTitle(FILE, "a", "after"),
      useTaskListStore.getState().setPriority(FILE, "a", "Critical"),
    ]);

    expect(tasksOf()[0].title).toBe("after");
    expect(tasksOf()[0].priority).toBe("Critical");
    expect(useTaskListStore.getState().unsavedPaths()).toEqual([FILE]);
  });

  it("is saved by a later write of the list that lands", async () => {
    await loadOne();
    flushTaskList.mockRejectedValueOnce(new Error("disk full"));
    await useTaskListStore.getState().updateTitle(FILE, "a", "after");
    await useTaskListStore.getState().setPriority(FILE, "a", "Critical");

    expect(useTaskListStore.getState().unsavedPaths()).toEqual([]);
  });

  it("reports an error instead of rejecting when a cross-file move write throws", async () => {
    useTaskListStore.setState({
      files: {
        "/src.json": { data: { id: "S", tasks: [makeTask({ id: "m" })] } },
        "/dst.json": { data: { id: "D", tasks: [] } },
      },
      fileLoadErrors: {},
      selectedKeys: new Set(),
      handledVisible: {},
      handledExpanded: {},
    });
    flushMove.mockRejectedValue(new Error("volume gone"));

    const result = await useTaskListStore
      .getState()
      .moveTasks("/src.json", "/dst.json", new Set(["m"]));

    expect(result).toEqual({
      status: "error",
      message: message("move.failed"),
    });
    // Nothing moved in memory, so neither list has a change to save.
    expect(useTaskListStore.getState().unsavedPaths()).toEqual([]);
    expect(tasksOf("/src.json").map((t) => t.id)).toEqual(["m"]);
  });
});

// A list left unsaved by a failed write waits for Retry, which quit and closing
// its tab also offer (hooks/use-window-close, state/workspace-store).
describe("unsaved lists", () => {
  async function loadOne(title = "before") {
    useTaskListStore.setState({ files: {} });
    loadTaskList.mockResolvedValue({
      status: "success",
      taskList: { filePath: FILE, data: { id: "L1", tasks: [makeTask({ id: "a", title })] } },
    });
    await useTaskListStore.getState().loadFile(FILE);
  }

  it("are named, and Retry writes the current copy", async () => {
    await loadOne();
    flushTaskList.mockRejectedValueOnce(new Error("disk full"));
    await useTaskListStore.getState().updateTitle(FILE, "a", "after");
    expect(useTaskListStore.getState().unsavedPaths()).toEqual([FILE]);

    const written: string[] = [];
    flushTaskList.mockImplementation(async (_p: string, getData: () => TaskListDto) => {
      written.push(getData().tasks[0].title);
      return { status: "success" };
    });
    useTaskListStore.getState().retryUnsaved();
    await vi.waitFor(() => expect(written).toEqual(["after"]));

    await vi.waitFor(() => expect(useTaskListStore.getState().unsavedPaths()).toEqual([]));
  });

  it("stay unsaved when the retry fails too", async () => {
    await loadOne();
    flushTaskList.mockRejectedValue(new Error("disk full"));
    await useTaskListStore.getState().updateTitle(FILE, "a", "after");

    useTaskListStore.getState().retryUnsaved([FILE]);
    await vi.waitFor(() => expect(flushTaskList).toHaveBeenCalledTimes(2));

    expect(useTaskListStore.getState().unsavedPaths()).toEqual([FILE]);
    expect(tasksOf()[0].title).toBe("after");
  });

  it("are retried only when named, or when none are", async () => {
    await loadOne();
    flushTaskList.mockRejectedValueOnce(new Error("disk full"));
    await useTaskListStore.getState().updateTitle(FILE, "a", "after");
    flushTaskList.mockClear();

    useTaskListStore.getState().retryUnsaved(["/other.json"]);

    expect(flushTaskList).not.toHaveBeenCalled();
  });

  it("keep their loaded copy when the file changes on disk", async () => {
    await loadOne();
    flushTaskList.mockRejectedValueOnce(new Error("disk full"));
    await useTaskListStore.getState().updateTitle(FILE, "a", "after");
    refreshTaskList.mockImplementation(async (_p: string, adopt: (data: TaskListDto) => boolean) =>
      adopt({ id: "L1", tasks: [makeTask({ id: "a", title: "disk" })] }) ? { status: "reloaded" } : { status: "kept" },
    );

    await useTaskListStore.getState().refreshFromDisk(FILE);

    expect(tasksOf()[0].title).toBe("after");
  });

  it("are forgotten when their tab closes", async () => {
    await loadOne();
    flushTaskList.mockRejectedValueOnce(new Error("disk full"));
    await useTaskListStore.getState().updateTitle(FILE, "a", "after");

    await useTaskListStore.getState().unloadFile(FILE);

    expect(useTaskListStore.getState().unsavedPaths()).toEqual([]);
  });
});

describe("addNewTask", () => {
  it("prepends a new task and flushes", async () => {
    seedFile();
    const result = await useTaskListStore.getState().addNewTask(FILE, { title: "New" });
    expect(result).toEqual({ status: "success", changed: true });
    expect(tasksOf()[0].title).toBe("New");
    expect(flushTaskList).toHaveBeenCalledTimes(1);
  });

  it("errors when the file is not loaded (no flush)", async () => {
    const result = await useTaskListStore.getState().addNewTask("/missing.json", { title: "x" });
    expect(result.status).toBe("error");
    expect(flushTaskList).not.toHaveBeenCalled();
  });
});

describe("removeTasks", () => {
  it("deletes the requested tasks in one write and clears them from the selection", async () => {
    seedFile();
    useTaskListStore.getState().setSelection(new Set([taskKey(FILE, "a"), taskKey(FILE, "b")]));
    const result = await useTaskListStore
      .getState()
      .removeTasks(FILE, new Set(["a", "b"]));
    expect(result).toEqual({ status: "success", changed: true });
    expect(tasksOf()).toEqual([]);
    expect(flushTaskList).toHaveBeenCalledTimes(1);
    expect(useTaskListStore.getState().selectedKeys.has(taskKey(FILE, "a"))).toBe(false);
    expect(useTaskListStore.getState().selectedKeys.has(taskKey(FILE, "b"))).toBe(false);
  });
});

describe("updateTitle no-op contract", () => {
  it("returns success WITHOUT flushing when the title is unchanged", async () => {
    seedFile([makeTask({ id: "a", title: "Same" })]);
    const result = await useTaskListStore.getState().updateTitle(FILE, "a", "Same");
    expect(result).toEqual({ status: "success", changed: false });
    expect(flushTaskList).not.toHaveBeenCalled();
  });

  it("flushes when the title actually changes", async () => {
    seedFile([makeTask({ id: "a", title: "Old" })]);
    await useTaskListStore.getState().updateTitle(FILE, "a", "New");
    expect(tasksOf()[0].title).toBe("New");
    expect(flushTaskList).toHaveBeenCalledTimes(1);
  });

  it("errors for a missing task", async () => {
    seedFile();
    const result = await useTaskListStore.getState().updateTitle(FILE, "nope", "x");
    expect(result.status).toBe("error");
  });
});

describe("setStatus validation gating", () => {
  it("blocks completing a task with an actionable note and does not flush", async () => {
    seedFile([makeTask({ id: "a", notes: [makeNote({ actionability: "Actionable" })] })]);
    const result = await useTaskListStore.getState().setStatus(FILE, "a", "Completed");
    expect(result.status).toBe("validation");
    expect(tasksOf()[0].status).toBe("Pending"); // unchanged
    expect(flushTaskList).not.toHaveBeenCalled();
  });

  it("allows completing a task with no actionable notes", async () => {
    seedFile([makeTask({ id: "a" })]);
    const result = await useTaskListStore.getState().setStatus(FILE, "a", "Completed");
    expect(result).toEqual({ status: "success", changed: true });
    expect(tasksOf()[0].status).toBe("Completed");
    expect(flushTaskList).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when status is already the target", async () => {
    seedFile([makeTask({ id: "a", status: "Pending" })]);
    const result = await useTaskListStore.getState().setStatus(FILE, "a", "Pending");
    expect(result).toEqual({ status: "success", changed: false });
    expect(flushTaskList).not.toHaveBeenCalled();
  });
});

describe("addNewNote", () => {
  it("rejects empty content without flushing", async () => {
    seedFile([makeTask({ id: "a" })]);
    const result = await useTaskListStore.getState().addNewNote(FILE, "a", "   ");
    expect(result.status).toBe("error");
    expect(flushTaskList).not.toHaveBeenCalled();
  });

  it("adds a note and flushes", async () => {
    seedFile([makeTask({ id: "a" })]);
    const result = await useTaskListStore.getState().addNewNote(FILE, "a", "hello", "Actionable");
    expect(result).toEqual({ status: "success", changed: true });
    expect(tasksOf()[0].notes[0]).toMatchObject({ content: "hello", actionability: "Actionable" });
  });
});

describe("reorder operations use the current selection", () => {
  it("sendToLast moves the selected task to the end of its group", async () => {
    seedFile([makeTask({ id: "a" }), makeTask({ id: "b" }), makeTask({ id: "c" })]);
    useTaskListStore.getState().setSelection(new Set([taskKey(FILE, "a")]));
    const result = await useTaskListStore.getState().sendToLast(FILE);
    expect(result).toEqual({ status: "success", changed: true });
    expect(tasksOf().map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("errors when nothing is selected", async () => {
    seedFile();
    const result = await useTaskListStore.getState().sendToLast(FILE);
    expect(result.status).toBe("error");
    expect(flushTaskList).not.toHaveBeenCalled();
  });

  it("kick with no movement (single task) is a success without flush", async () => {
    seedFile([makeTask({ id: "a" })]);
    useTaskListStore.getState().setSelection(new Set([taskKey(FILE, "a")]));
    const result = await useTaskListStore.getState().kick(FILE, 5);
    expect(result).toEqual({ status: "success", changed: false });
    expect(flushTaskList).not.toHaveBeenCalled();
  });
});

// reorderTick signals the task list to re-scroll the still-selected task into
// view after a reorder. Mutations that advance the selection instead
// (dropkick/status/priority/due) must NOT bump it — otherwise the list would
// chase the stale pre-advance selection and jump.
describe("reorderTick scroll-follow signal", () => {
  it("increments when a reorder changes task order", async () => {
    seedFile([makeTask({ id: "a" }), makeTask({ id: "b" }), makeTask({ id: "c" })]);
    useTaskListStore.getState().setSelection(new Set([taskKey(FILE, "a")]));
    const before = useTaskListStore.getState().reorderTick;
    await useTaskListStore.getState().sendToLast(FILE);
    expect(useTaskListStore.getState().reorderTick).toBe(before + 1);
  });

  it("does not increment when a reorder makes no change", async () => {
    seedFile([makeTask({ id: "a" })]);
    useTaskListStore.getState().setSelection(new Set([taskKey(FILE, "a")]));
    const before = useTaskListStore.getState().reorderTick;
    await useTaskListStore.getState().kick(FILE, 5); // single task: no movement
    expect(useTaskListStore.getState().reorderTick).toBe(before);
  });

  it("does not increment for dropkick, even though it reorders", async () => {
    seedFile([makeTask({ id: "a" }), makeTask({ id: "b" })]);
    useTaskListStore.getState().setSelection(new Set([taskKey(FILE, "a")]));
    const before = useTaskListStore.getState().reorderTick;
    const result = await useTaskListStore.getState().dropkick(FILE);
    // Reports a real reorder so the keyboard handler advances selection only
    // when something actually moved.
    expect(result).toEqual({ status: "success", changed: true });
    expect(tasksOf().map((t) => t.id)).toEqual(["b", "a"]); // a sent to bottom
    expect(useTaskListStore.getState().reorderTick).toBe(before);
  });

  it("reports changed:false for a dropkick that moves nothing", async () => {
    // A single Default/Pending task with no due date is already at the bottom,
    // so dropkick is a no-op — the keyboard handler must not advance selection.
    seedFile([makeTask({ id: "a" })]);
    useTaskListStore.getState().setSelection(new Set([taskKey(FILE, "a")]));
    const result = await useTaskListStore.getState().dropkick(FILE);
    expect(result).toEqual({ status: "success", changed: false });
  });

  it("does not increment for status changes", async () => {
    seedFile([makeTask({ id: "a" }), makeTask({ id: "b" })]);
    const before = useTaskListStore.getState().reorderTick;
    await useTaskListStore.getState().setStatus(FILE, "a", "Completed");
    expect(useTaskListStore.getState().reorderTick).toBe(before);
  });
});

describe("flush conflict reload", () => {
  it("applies reloaded disk data and reports the reload apart from a failed write", async () => {
    seedFile([makeTask({ id: "a", title: "local" })]);
    const reloaded: TaskListDto = { id: "L1", tasks: [makeTask({ id: "z", title: "from disk" })] };
    flushTaskList.mockResolvedValue({ status: "reloaded", data: reloaded, message: "changed externally" });

    const result = await useTaskListStore.getState().addNewTask(FILE, { title: "x" });
    expect(result).toEqual({ status: "reloaded", message: "changed externally" });
    // The store reflects the disk state after a reload.
    expect(tasksOf().map((t) => t.id)).toEqual(["z"]);
  });
});

describe("unloadFile", () => {
  it("drains pending writes then removes all per-file state", async () => {
    seedFile();
    useTaskListStore.setState({ handledVisible: { [FILE]: 10 }, handledExpanded: { [FILE]: true } });
    await useTaskListStore.getState().unloadFile(FILE);
    expect(forgetTaskList).toHaveBeenCalledWith(FILE);
    expect(useTaskListStore.getState().files[FILE]).toBeUndefined();
    expect(useTaskListStore.getState().handledVisible[FILE]).toBeUndefined();
    expect(useTaskListStore.getState().handledExpanded[FILE]).toBeUndefined();
  });
});

describe("moveTasks", () => {
  const SRC = "/src.json";
  const DST = "/dst.json";

  function seedTwoFiles() {
    useTaskListStore.setState({
      files: {
        [SRC]: { data: { id: "SRC", tasks: [makeTask({ id: "s1" }), makeTask({ id: "s2" })] } },
        [DST]: { data: { id: "DST", tasks: [makeTask({ id: "d1" })] } },
      },
      fileLoadErrors: {},
      selectedKeys: new Set(),
      handledVisible: {},
      handledExpanded: {},
    });
  }

  it("rejects a move where source and destination are the same", async () => {
    const result = await useTaskListStore.getState().moveTasks(SRC, SRC, new Set(["s1"]));
    expect(result.status).toBe("error");
    expect(flushMove).not.toHaveBeenCalled();
  });

  it("applies both files' data and clears the selection on success", async () => {
    seedTwoFiles();
    useTaskListStore.getState().setSelection(new Set([taskKey(SRC, "s1")]));
    const sourceData: TaskListDto = { id: "SRC", tasks: [makeTask({ id: "s2" })] };
    const destData: TaskListDto = { id: "DST", tasks: [makeTask({ id: "s1" }), makeTask({ id: "d1" })] };
    flushMove.mockImplementation(async (_s, _d, getInputs: () => unknown) => {
      getInputs(); // exercise the closure that reads latest store state
      return { status: "success", sourceData, destData };
    });

    const result = await useTaskListStore.getState().moveTasks(SRC, DST, new Set(["s1"]));
    expect(result).toEqual({ status: "success" });
    expect(tasksOf(SRC).map((t) => t.id)).toEqual(["s2"]);
    expect(tasksOf(DST).map((t) => t.id)).toEqual(["s1", "d1"]);
    expect(useTaskListStore.getState().selectedKeys.size).toBe(0);
  });

  it("maps a destination conflict to a descriptive error and leaves state intact", async () => {
    seedTwoFiles();
    flushMove.mockResolvedValue({ status: "dest-conflict" });
    const result = await useTaskListStore.getState().moveTasks(SRC, DST, new Set(["s1"]));
    expect(result.status).toBe("error");
    expect(result.status === "error" && inEnglish(result.message)).toMatch(/destination file was modified/i);
    // No tasks moved.
    expect(tasksOf(SRC).map((t) => t.id)).toEqual(["s1", "s2"]);
    expect(tasksOf(DST).map((t) => t.id)).toEqual(["d1"]);
  });
});

describe("handled pagination", () => {
  it("showMoreHandled grows the visible count by the page size", () => {
    seedFile();
    useTaskListStore.getState().showMoreHandled(FILE, 50);
    expect(useTaskListStore.getState().handledVisible[FILE]).toBe(100);
    useTaskListStore.getState().showMoreHandled(FILE, 50);
    expect(useTaskListStore.getState().handledVisible[FILE]).toBe(150);
  });

  it("setHandledExpanded records expansion per view", () => {
    useTaskListStore.getState().setHandledExpanded(FILE, true);
    expect(useTaskListStore.getState().handledExpanded[FILE]).toBe(true);
  });
});

describe("refreshFromDisk", () => {
  // The repository offers a changed copy to the store and reports whether it
  // was taken, as refreshTaskList does.
  function diskHolds(tasks: TaskListDto["tasks"]) {
    refreshTaskList.mockImplementation(async (_p: string, adopt: (data: TaskListDto) => boolean) =>
      adopt({ id: "L1", tasks }) ? { status: "reloaded" } : { status: "kept" },
    );
  }

  it("takes the file's new copy and keeps the selection where its tasks remain", async () => {
    seedFile([makeTask({ id: "a" }), makeTask({ id: "b" })]);
    const elsewhere = taskKey("/other.json", "b");
    useTaskListStore.setState({ selectedKeys: new Set([taskKey(FILE, "a"), taskKey(FILE, "b"), elsewhere]) });
    diskHolds([makeTask({ id: "a", title: "edited outside" }), makeTask({ id: "c" })]);

    await useTaskListStore.getState().refreshFromDisk(FILE);

    expect(tasksOf().map((t) => [t.id, t.title])).toEqual([["a", "edited outside"], ["c", expect.any(String)]]);
    expect(useTaskListStore.getState().selectedKeys).toEqual(new Set([taskKey(FILE, "a"), elsewhere]));
  });

  it("keeps the loaded copy while a draft for one of its tasks is unsaved", async () => {
    seedFile([makeTask({ id: "a", title: "loaded" })]);
    useNoteDraftStore.setState({ drafts: { [composerDraftKey("a")]: "half a note" } });
    diskHolds([makeTask({ id: "a", title: "edited outside" })]);

    await useTaskListStore.getState().refreshFromDisk(FILE);

    expect(tasksOf().map((t) => t.title)).toEqual(["loaded"]);
    expect(await refreshTaskList.mock.results[0]?.value).toEqual({ status: "kept" });
  });

  it("keeps the loaded copy while one of its saves is on its way", async () => {
    seedFile([makeTask({ id: "a", title: "loaded" })]);
    let finish!: (result: unknown) => void;
    flushTaskList.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const saving = useTaskListStore.getState().updateTitle(FILE, "a", "typed in app");
    diskHolds([makeTask({ id: "a", title: "edited outside" })]);

    await useTaskListStore.getState().refreshFromDisk(FILE);

    expect(tasksOf().map((t) => t.title)).toEqual(["typed in app"]);
    finish({ status: "success" });
    await saving;
  });

  it("keeps the loaded copy when the file is gone or unreadable, and says so until it reads back", async () => {
    seedFile([makeTask({ id: "a" })]);
    refreshTaskList.mockResolvedValueOnce({ status: "missing" });
    await useTaskListStore.getState().refreshFromDisk(FILE);
    expect(tasksOf().map((t) => t.id)).toEqual(["a"]);
    expect(useTaskListStore.getState().fileDiskErrors[FILE]).toEqual({ status: "missing" });

    refreshTaskList.mockResolvedValueOnce({ status: "invalid", message: "bad json" });
    await useTaskListStore.getState().refreshFromDisk(FILE);
    expect(useTaskListStore.getState().fileDiskErrors[FILE]).toEqual({ status: "invalid", message: "bad json" });

    refreshTaskList.mockResolvedValueOnce({ status: "unchanged" });
    await useTaskListStore.getState().refreshFromDisk(FILE);
    expect(useTaskListStore.getState().fileDiskErrors[FILE]).toBeUndefined();
  });

  it("clears the problem once the list is saved again or closed", async () => {
    seedFile([makeTask({ id: "a" })]);
    refreshTaskList.mockResolvedValue({ status: "missing" });
    await useTaskListStore.getState().refreshFromDisk(FILE);
    await useTaskListStore.getState().updateTitle(FILE, "a", "saved");
    expect(useTaskListStore.getState().fileDiskErrors[FILE]).toBeUndefined();

    await useTaskListStore.getState().refreshFromDisk(FILE);
    await useTaskListStore.getState().unloadFile(FILE);
    expect(useTaskListStore.getState().fileDiskErrors[FILE]).toBeUndefined();
  });

  it("leaves a list that is not loaded alone", async () => {
    await useTaskListStore.getState().refreshFromDisk(FILE);
    expect(refreshTaskList).not.toHaveBeenCalled();
  });
});

describe("a list already open from another file", () => {
  // A Finder or Explorer copy carries its source's list id; it is refused
  // rather than opened beside it, and no id is ever reassigned.
  const COPY = "/list copy.json";
  const copied = (tasks = [makeTask({ id: "a" })]): TaskListDto => ({ id: "L1", tasks });
  const refusal = { status: "duplicate", path: COPY, otherPath: FILE };

  it("is not opened, and the failure names both files", async () => {
    seedFile();
    loadTaskList.mockResolvedValue({ status: "success", taskList: { filePath: COPY, data: copied() } });

    expect(await useTaskListStore.getState().loadFile(COPY)).toEqual(refusal);

    expect(useTaskListStore.getState().files[COPY]).toBeUndefined();
    expect(useTaskListStore.getState().fileLoadErrors[COPY]).toEqual(refusal);
  });

  it("opens once the other file is closed", async () => {
    seedFile();
    await useTaskListStore.getState().unloadFile(FILE);
    loadTaskList.mockResolvedValue({ status: "success", taskList: { filePath: COPY, data: copied() } });

    expect(await useTaskListStore.getState().loadFile(COPY)).toEqual({ status: "success" });
  });

  it("is not taken when the file changes on disk, and the loaded copy stays", async () => {
    seedFile();
    useTaskListStore.setState((state) => ({
      files: { ...state.files, [COPY]: { data: { id: "L2", tasks: [] } } },
    }));
    refreshTaskList.mockImplementation(async (_p: string, adopt: (data: TaskListDto) => boolean) =>
      adopt(copied()) ? { status: "reloaded" } : { status: "kept" },
    );

    await useTaskListStore.getState().refreshFromDisk(COPY);

    expect(useTaskListStore.getState().files[COPY]?.data.id).toBe("L2");
    expect(useTaskListStore.getState().fileDiskErrors[COPY]).toEqual(refusal);
  });

  it("is not taken through a save conflict's reload", async () => {
    seedFile();
    loadTaskList.mockResolvedValue({
      status: "success",
      taskList: { filePath: COPY, data: { id: "L2", tasks: [makeTask({ id: "own" })] } },
    });
    await useTaskListStore.getState().loadFile(COPY);
    flushTaskList.mockResolvedValue({ status: "reloaded", data: copied(), message: "changed externally" });

    await useTaskListStore.getState().addNewTask(COPY, { title: "x" });

    // The new task stays, unsaved, with the refusal as the reason.
    expect(tasksOf(COPY).map((t) => t.title)).toContain("x");
    expect(tasksOf(COPY).map((t) => t.id)).toContain("own");
    expect(useTaskListStore.getState().files[COPY]?.data.id).toBe("L2");
    expect(useTaskListStore.getState().unsavedFiles[COPY]).toEqual(describeDiskFailure(refusal as never));
  });
});

describe("held save/move/reload settlement", () => {
  it("preserves a later optimistic edit when an earlier save reloads", async () => {
    seedFile([makeTask({ id: "a", title: "before", description: "before" })]);
    let finish!: (value: unknown) => void;
    flushTaskList.mockImplementationOnce((_p, getData) => {
      getData();
      return new Promise((resolve) => { finish = resolve; });
    });
    const first = useTaskListStore.getState().updateTitle(FILE, "a", "submitted");
    const later = useTaskListStore.getState().updateDescription(FILE, "a", "later");
    finish({ status: "reloaded", data: { id: "L1", tasks: [makeTask({ id: "a", title: "disk", description: "before" })] }, message: message("write.reloaded") });
    await Promise.all([first, later]);
    expect(tasksOf()[0].title).toBe("disk");
    expect(tasksOf()[0].description).toBe("later");
  });

  it("keeps a later moved-task edit in the destination and writes it there", async () => {
    const moved = makeTask({ id: "m" });
    useTaskListStore.setState({ files: {
      "/src.json": { data: { id: "S", tasks: [moved] } },
      "/dst.json": { data: { id: "D", tasks: [] } },
    } });
    let finish!: (value: unknown) => void;
    flushMove.mockImplementationOnce((_s, _d, getInputs) => {
      getInputs();
      return new Promise((resolve) => { finish = resolve; });
    });
    const move = useTaskListStore.getState().moveTasks("/src.json", "/dst.json", new Set(["m"]));
    await useTaskListStore.getState().updateTitle("/src.json", "m", "later moved");
    finish({ status: "success", sourceData: { id: "S", tasks: [] }, destData: { id: "D", tasks: [moved] } });
    await move;
    expect(tasksOf("/src.json")).toEqual([]);
    expect(tasksOf("/dst.json")[0].title).toBe("later moved");
    expect(flushTaskList.mock.calls.some(([path]) => path === "/dst.json")).toBe(true);
  });
});


// A save conflict's Reload takes the disk copy, keeping edits made after the
// save was submitted.
describe("Reload preserves later edit intent", () => {
  function holdSave(): (value: unknown) => void {
    let finish!: (value: unknown) => void;
    flushTaskList.mockImplementationOnce((_p, getData) => {
      getData();
      return new Promise((resolve) => { finish = resolve; });
    });
    return (value) => finish(value);
  }

  it("retains title A/B/A across a held conflict Reload of disk D", async () => {
    seedFile([makeTask({ id: "a", title: "A" })]);
    const finish = holdSave();
    const operation = useTaskListStore.getState().updateDescription(FILE, "a", "submitted");
    await useTaskListStore.getState().updateTitle(FILE, "a", "B");
    await useTaskListStore.getState().updateTitle(FILE, "a", "A");
    const disk = { id: "L1", tasks: [makeTask({ id: "a", title: "D" })] };
    finish({ status: "reloaded", data: disk, message: message("write.reloaded") });
    await operation;
    expect(tasksOf()[0].title).toBe("A");
  });

  it("retains a later task/note edit when a conflict Reload removes its disk subject", async () => {
    seedFile([
      makeTask({ id: "a", title: "before" }),
      makeTask({ id: "b", notes: [makeNote({ id: "n", content: "before" })] }),
      makeTask({ id: "unchanged" }),
    ]);
    const finish = holdSave();
    const operation = useTaskListStore.getState().updateDescription(FILE, "unchanged", "submitted");
    await useTaskListStore.getState().updateTitle(FILE, "a", "later task");
    await useTaskListStore.getState().updateNote(FILE, "b", "n", "later note");
    finish({ status: "reloaded", data: { id: "L1", tasks: [makeTask({ id: "b", notes: [] })] }, message: message("write.reloaded") });
    await operation;
    expect(tasksOf().map((t) => t.id)).toEqual(["a", "b"]);
    expect(tasksOf()[0].title).toBe("later task");
    expect(tasksOf()[1].notes[0].content).toBe("later note");
  });
});
