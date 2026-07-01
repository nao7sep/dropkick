import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TaskListDto } from "../../src/models";

// --- Repository mock ---
// The store's only side effects go through ../repositories. We mock the whole
// barrel so nothing touches the filesystem and we can assert flush behavior.

const loadTaskList = vi.fn();
const createTaskListFile = vi.fn();
const flushTaskList = vi.fn();
const forceFlushTaskList = vi.fn();
const flushMove = vi.fn();
const forgetTaskList = vi.fn(async (_p: string) => {});

vi.mock("../../src/repositories", () => ({
  loadTaskList: (p: string) => loadTaskList(p),
  createTaskListFile: (p: string) => createTaskListFile(p),
  flushTaskList: (p: string, getData: () => TaskListDto) => flushTaskList(p, getData),
  forceFlushTaskList: (p: string, data: TaskListDto) => forceFlushTaskList(p, data),
  flushMove: (s: string, d: string, getInputs: () => unknown) => flushMove(s, d, getInputs),
  forgetTaskList: (p: string) => forgetTaskList(p),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  loadFailureFields: (path: string, result: { status: string; message?: string }) => ({
    path,
    status: result.status,
    ...(result.message !== undefined ? { error: { message: result.message } } : {}),
  }),
}));

import { useTaskListStore } from "../../src/state/task-list-store";
import { usePreferencesStore } from "../../src/state/preferences-store";
import { makeTask, makeNote } from "../helpers/task";
import { taskKey } from "../../src/utils";

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
    files: { [FILE]: { data: { version: "1.0.0", id: "L1", tasks } } },
    fileLoadErrors: {},
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
  forceFlushTaskList.mockReset();
  flushMove.mockReset();
  forgetTaskList.mockClear();
  flushSucceeds();
  // Reset preferences to a known timezone/window for reorder grouping.
  usePreferencesStore.setState({
    preferences: { ...usePreferencesStore.getState().preferences, timezone: "UTC", dueSoonDays: 7 },
  });
  useTaskListStore.setState({
    files: {},
    fileLoadErrors: {},
    selectedKeys: new Set(),
    handledVisible: {},
    handledExpanded: {},
  });
});

describe("loadFile", () => {
  it("stores loaded data on success", async () => {
    loadTaskList.mockResolvedValue({
      status: "success",
      taskList: { filePath: FILE, data: { version: "1.0.0", tasks: [makeTask({ id: "x" })] } },
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
    expect(result).toEqual({ status: "error", message: "backend boom" });
    expect(useTaskListStore.getState().fileLoadErrors[FILE]).toEqual({
      status: "error",
      message: "backend boom",
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
      taskList: { filePath: FILE, data: { version: "1.0.0", tasks: [makeTask({ id: "z" })] } },
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
      taskList: { filePath: FILE, data: { version: "1.0.0", tasks: [makeTask({ id: "ok" })] } },
    });
    const second = await useTaskListStore.getState().loadFile(FILE);
    expect(second).toEqual({ status: "success" });
    expect(loadTaskList).toHaveBeenCalledTimes(2);
    expect(tasksOf().map((t) => t.id)).toEqual(["ok"]);
  });
});

describe("reloadFile", () => {
  it("records an error (keeping existing data) instead of rejecting when the read throws", async () => {
    seedFile([makeTask({ id: "old" })]);
    loadTaskList.mockRejectedValue(new Error("gone"));
    await useTaskListStore.getState().reloadFile(FILE);
    expect(useTaskListStore.getState().fileLoadErrors[FILE]).toEqual({
      status: "error",
      message: "gone",
    });
    // The previously loaded data is retained so the user doesn't lose the view.
    expect(tasksOf().map((t) => t.id)).toEqual(["old"]);
  });
});

describe("addNewTask", () => {
  it("prepends a new task and flushes", async () => {
    seedFile();
    const result = await useTaskListStore.getState().addNewTask(FILE, { title: "New" });
    expect(result).toEqual({ status: "success" });
    expect(tasksOf()[0].title).toBe("New");
    expect(flushTaskList).toHaveBeenCalledTimes(1);
  });

  it("errors when the file is not loaded (no flush)", async () => {
    const result = await useTaskListStore.getState().addNewTask("/missing.json", { title: "x" });
    expect(result.status).toBe("error");
    expect(flushTaskList).not.toHaveBeenCalled();
  });
});

describe("removeTask", () => {
  it("deletes the task and clears it from the selection", async () => {
    seedFile();
    useTaskListStore.getState().setSelection(new Set([taskKey(FILE, "a"), taskKey(FILE, "b")]));
    const result = await useTaskListStore.getState().removeTask(FILE, "a");
    expect(result).toEqual({ status: "success" });
    expect(tasksOf().map((t) => t.id)).toEqual(["b"]);
    expect(useTaskListStore.getState().selectedKeys.has(taskKey(FILE, "a"))).toBe(false);
    expect(useTaskListStore.getState().selectedKeys.has(taskKey(FILE, "b"))).toBe(true);
  });
});

describe("updateTitle no-op contract", () => {
  it("returns success WITHOUT flushing when the title is unchanged", async () => {
    seedFile([makeTask({ id: "a", title: "Same" })]);
    const result = await useTaskListStore.getState().updateTitle(FILE, "a", "Same");
    expect(result).toEqual({ status: "success" });
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
    expect(result).toEqual({ status: "success" });
    expect(tasksOf()[0].status).toBe("Completed");
    expect(flushTaskList).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when status is already the target", async () => {
    seedFile([makeTask({ id: "a", status: "Pending" })]);
    const result = await useTaskListStore.getState().setStatus(FILE, "a", "Pending");
    expect(result).toEqual({ status: "success" });
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
    expect(result).toEqual({ status: "success" });
    expect(tasksOf()[0].notes[0]).toMatchObject({ content: "hello", actionability: "Actionable" });
  });
});

describe("reorder operations use the current selection", () => {
  it("sendToLast moves the selected task to the end of its group", async () => {
    seedFile([makeTask({ id: "a" }), makeTask({ id: "b" }), makeTask({ id: "c" })]);
    useTaskListStore.getState().setSelection(new Set([taskKey(FILE, "a")]));
    const result = await useTaskListStore.getState().sendToLast(FILE);
    expect(result).toEqual({ status: "success" });
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
    expect(result).toEqual({ status: "success" });
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
  it("applies reloaded disk data and reports an error when the file changed externally", async () => {
    seedFile([makeTask({ id: "a", title: "local" })]);
    const reloaded: TaskListDto = { version: "1.0.0", id: "L1", tasks: [makeTask({ id: "z", title: "from disk" })] };
    flushTaskList.mockResolvedValue({ status: "reloaded", data: reloaded, message: "changed externally" });

    const result = await useTaskListStore.getState().addNewTask(FILE, { title: "x" });
    expect(result).toEqual({ status: "error", message: "changed externally" });
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
        [SRC]: { data: { version: "1.0.0", id: "SRC", tasks: [makeTask({ id: "s1" }), makeTask({ id: "s2" })] } },
        [DST]: { data: { version: "1.0.0", id: "DST", tasks: [makeTask({ id: "d1" })] } },
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
    const sourceData: TaskListDto = { version: "1.0.0", id: "SRC", tasks: [makeTask({ id: "s2" })] };
    const destData: TaskListDto = { version: "1.0.0", id: "DST", tasks: [makeTask({ id: "s1" }), makeTask({ id: "d1" })] };
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
    expect(result.status === "error" && result.message).toMatch(/destination file was modified/i);
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
