// Real stores/repositories/serial ownership; only native storage is substituted.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useTaskListStore } from "../../src/state/task-list-store";
import { useWorkspaceStore } from "../../src/state/workspace-store";
import { useDraftStore } from "../../src/state/draft-store";
import { useDialogStore, refuseDialogs } from "../../src/state/dialog-store";
import { drainSerial } from "../../src/repositories/file-system";
import { openWorkspaceSession } from "../../src/services/open-workspace-session";
import { flushAppState } from "../../src/repositories/app-state-repository";
import { fieldDraftKey } from "../../src/services/drafts";
import { commitParkedFields } from "../../src/services/commit-task-fields";
import { createDefaultAppState, createDefaultWorkspace, createTab, WRITER, type TaskListDto } from "../../src/models";
import { makeTask } from "../helpers/task";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
let docs: Map<string, { data: unknown; hash: string }>;
let writes: string[];
let io: string[];
let holdWrite: (() => Promise<void>) | undefined;
let failWrites: boolean;
let holdRead: ((path: string) => Promise<void>) | undefined;
function put(path: string, data: unknown) { docs.set(path, { data, hash: `initial-${path}` }); }
function list(id: string, title = "Original"): TaskListDto { return { id, tasks: [makeTask({ id: "task", title })] }; }
function workspace(path: string, lists: string[]) {
  put(path, { ...createDefaultWorkspace(path), openTabs: lists.map((p) => createTab(p, p)) });
}
beforeEach(() => {
  refuseDialogs(false);
  useDialogStore.setState({ current: null, queue: [] });
  useTaskListStore.setState({ files: {}, fileLoadErrors: {}, fileDiskErrors: {}, unsavedFiles: {}, selectedKeys: new Set() });
  useWorkspaceStore.setState({ loaded: false, filePath: "", workspace: createDefaultWorkspace("Empty") });
  useDraftStore.setState({ drafts: {}, editedAtUtc: {}, draftVersions: {}, parkedTasks: {} });
  docs = new Map(); writes = []; io = []; holdWrite = undefined; failWrites = false; holdRead = undefined;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const { path, contents, expectedHash } = (args ?? {}) as { path: string; contents: string; expectedHash?: string };
    const doc = docs.get(path);
    if (command === "read_json_file_with_hash") {
      io.push(`read:${path}`);
      await holdRead?.(path);
      return doc ? expectedHash === doc.hash ? { status: "unchanged" } : { status: "success", ...structuredClone(doc) } : { status: "missing" };
    }
    if (command === "read_text_file") return doc ? { status: "success", text: JSON.stringify({ ...doc.data as object, format: { owner: "dropkick", kind: "workspace", version: 1 }, writer: WRITER }) } : { status: "missing" };
    if (command === "write_text_file_atomic" || command === "save_task_file") {
      if (command === "save_task_file") {
        const current = docs.get(path)?.hash;
        if (current === undefined) return { status: "missing" };
        if (current !== expectedHash) return { status: "conflict" };
      }
      await holdWrite?.();
      if (failWrites) throw new Error("disk full");
      io.push(`write:${path}`);
      writes.push(path); docs.set(path, { data: JSON.parse(contents), hash: `saved-${writes.length}` });
      return command === "save_task_file" ? { status: "saved", hash: docs.get(path)!.hash } : docs.get(path)!.hash;
    }
    return undefined;
  });
});

it("a held outgoing refresh cannot delay adoption, and the list retires after it in its own order", async () => {
  put("/old.json", list("identity")); put("/copy.json", list("other"));
  workspace("/a.json", ["/old.json"]); workspace("/b.json", ["/copy.json"]);
  await openWorkspaceSession("/a.json"); await useTaskListStore.getState().loadFile("/old.json");
  put("/old.json", list("identity", "Outside change"));
  let release!: () => void;
  let reached!: () => void;
  const holding = new Promise<void>((resolve) => { reached = resolve; });
  holdRead = (path) => path === "/old.json" ? new Promise<void>((resolve) => { release = resolve; reached(); }) : Promise.resolve();
  const refresh = useTaskListStore.getState().refreshFromDisk("/old.json");
  await holding;
  const opening = openWorkspaceSession("/b.json");
  try {
    expect(await opening).toEqual({ kind: "success" });
    expect(useWorkspaceStore.getState().filePath).toBe("/b.json");
    expect(await useTaskListStore.getState().loadFile("/copy.json")).toEqual({ status: "success" });
  } finally { holdRead = undefined; release(); await Promise.all([refresh, opening]); }
  await Promise.all([...docs.keys()].map(drainSerial));
  expect(Object.keys(useTaskListStore.getState().files)).toEqual(["/copy.json"]);
  expect(useTaskListStore.getState().fileDiskErrors).toEqual({});
});

it.each([false, true])("a pending outgoing initial load loses admission in either settlement order (%s)", async (oldFirst) => {
  put("/old.json", list("identity")); put("/copy.json", list("identity"));
  workspace("/a.json", ["/old.json"]); workspace("/b.json", ["/copy.json"]);
  await openWorkspaceSession("/a.json");
  let release!: () => void;
  let reached!: () => void;
  const holding = new Promise<void>((resolve) => { reached = resolve; });
  holdRead = (path) => path === "/old.json" ? new Promise<void>((resolve) => { release = resolve; reached(); }) : Promise.resolve();
  const loading = useTaskListStore.getState().loadFile("/old.json");
  await holding;
  try {
    expect(await openWorkspaceSession("/b.json")).toEqual({ kind: "success" });
    if (oldFirst) { holdRead = undefined; release(); await loading; }
    expect(await useTaskListStore.getState().loadFile("/copy.json")).toEqual({ status: "success" });
  } finally { holdRead = undefined; release(); await loading; }
  await Promise.all([...docs.keys()].map(drainSerial));
  expect(Object.keys(useTaskListStore.getState().files)).toEqual(["/copy.json"]);
  expect(useTaskListStore.getState().fileLoadErrors).toEqual({});
});

it("a reopening request waiting on physical retirement can be revoked by a second departure", async () => {
  put("/old.json", list("identity")); put("/copy.json", list("identity"));
  workspace("/a.json", ["/old.json"]); workspace("/b.json", []); workspace("/c.json", ["/copy.json"]);
  await openWorkspaceSession("/a.json"); await useTaskListStore.getState().loadFile("/old.json");
  put("/old.json", list("identity", "Outside change"));
  let release!: () => void;
  let reached!: () => void;
  const holding = new Promise<void>((resolve) => { reached = resolve; });
  holdRead = (path) => path === "/old.json" ? new Promise<void>((resolve) => { release = resolve; reached(); }) : Promise.resolve();
  const refresh = useTaskListStore.getState().refreshFromDisk("/old.json");
  await holding;
  let reopening: Promise<unknown> | undefined;
  try {
    await openWorkspaceSession("/b.json"); await openWorkspaceSession("/a.json");
    reopening = useTaskListStore.getState().loadFile("/old.json");
    await openWorkspaceSession("/c.json");
  } finally { holdRead = undefined; release(); await Promise.all([refresh, reopening]); }
  await Promise.all([...docs.keys()].map(drainSerial));
  expect(Object.keys(useTaskListStore.getState().files)).toEqual([]);
  expect(await useTaskListStore.getState().loadFile("/copy.json")).toEqual({ status: "success" });
});
afterEach(async () => { refuseDialogs(true); await Promise.all([...docs.keys()].map(drainSerial)); refuseDialogs(false); });

it("refuses the readable duplicate state left by an interrupted move before publishing either list", async () => {
  put("/source.json", list("source")); put("/dest.json", list("destination", "Different copy"));
  await useTaskListStore.getState().loadFile("/source.json");
  await useTaskListStore.getState().loadFile("/dest.json");
  const before = structuredClone(docs);
  expect((await useTaskListStore.getState().moveTasks("/source.json", "/dest.json", new Set(["task"]))).status).toBe("error");
  expect(writes).toEqual([]); expect(docs).toEqual(before);
  for (const path of ["/source.json", "/dest.json"]) {
    await useTaskListStore.getState().unloadFile(path);
    expect(await useTaskListStore.getState().loadFile(path)).toEqual({ status: "success" });
    const tasks = useTaskListStore.getState().files[path].data.tasks;
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
  }
});

it("reopening waits for pending retirement and registers a fresh usable copy", async () => {
  put("/old.json", list("old")); await useTaskListStore.getState().loadFile("/old.json");
  let release!: () => void;
  let reached!: () => void;
  const holding = new Promise<void>((resolve) => { reached = resolve; });
  holdWrite = () => new Promise<void>((resolve) => { release = resolve; reached(); });
  const saving = useTaskListStore.getState().updateTitle("/old.json", "task", "Saved");
  await holding;
  const retiring = useTaskListStore.getState().unloadFile("/old.json");
  const reopening = useTaskListStore.getState().loadFile("/old.json");
  holdWrite = undefined; release();
  await Promise.all([saving, retiring, reopening]);
  expect(useTaskListStore.getState().files["/old.json"]?.data.tasks[0].title).toBe("Saved");
  await useTaskListStore.getState().updateTitle("/old.json", "task", "Saved again");
  expect(useTaskListStore.getState().unsavedPaths()).toEqual([]);
});

it("switching releases old-only lists and their identity while retaining note context", async () => {
  put("/old.json", list("identity")); put("/copy.json", list("identity"));
  workspace("/a.json", ["/old.json"]); workspace("/b.json", ["/copy.json"]);
  await openWorkspaceSession("/a.json"); await useTaskListStore.getState().loadFile("/old.json");
  useDraftStore.getState().setDraft("task|%2Fold.json", "Unsent note");
  expect(await openWorkspaceSession("/b.json")).toEqual({ kind: "success" });
  await drainSerial("/old.json");
  expect(Object.keys(useTaskListStore.getState().files)).toEqual([]);
  expect(useDraftStore.getState().drafts["task|%2Fold.json"]).toBe("Unsent note");
  expect(useDraftStore.getState().parkedTasks["task|%2Fold.json"].title).toBe("Original");
  expect(await useTaskListStore.getState().loadFile("/copy.json")).toEqual({ status: "success" });
  expect(await openWorkspaceSession("/a.json")).toEqual({ kind: "success" });
  expect(await useTaskListStore.getState().loadFile("/old.json")).toEqual({ status: "success" });
});

it("keeps the old session reachable when an outgoing list is unsaved or the new workspace is missing", async () => {
  put("/old.json", list("old")); workspace("/a.json", ["/old.json"]); workspace("/b.json", []);
  await openWorkspaceSession("/a.json"); await useTaskListStore.getState().loadFile("/old.json");
  expect((await openWorkspaceSession("/missing.json")).kind).toBe("workspace");
  expect(useTaskListStore.getState().files["/old.json"]).toBeDefined();
  failWrites = true;
  await useTaskListStore.getState().updateTitle("/old.json", "task", "Retained");
  failWrites = false;
  expect((await openWorkspaceSession("/b.json")).kind).toBe("tasks");
  expect(useWorkspaceStore.getState().filePath).toBe("/a.json");
  expect(useTaskListStore.getState().files["/old.json"].data.tasks[0].title).toBe("Retained");
});

it("an unrelated held disposable-state save does not prevent a readable workspace opening", async () => {
  workspace("/new-workspace.json", []);
  let release!: () => void;
  let reached!: () => void;
  const holding = new Promise<void>((resolve) => { reached = resolve; });
  holdWrite = () => new Promise<void>((resolve) => { release = resolve; reached(); });
  const optional = flushAppState("/state.json", createDefaultAppState);
  await holding;
  let opened = false;
  const opening = openWorkspaceSession("/new-workspace.json").then((result) => { opened = result.kind === "success"; });
  try { await opening; expect(opened).toBe(true); }
  finally { holdWrite = undefined; release(); await Promise.all([optional, opening]); }
});

it("a moved field keeps its copy owner even with a third task copy loaded", async () => {
  put("/source.json", list("source")); put("/dest.json", { id: "dest", tasks: [] }); put("/third.json", list("third", "Third copy"));
  for (const path of ["/third.json", "/source.json", "/dest.json"]) await useTaskListStore.getState().loadFile(path);
  useDraftStore.getState().setDraft(fieldDraftKey("task", "title", "/source.json"), "Moved draft");
  expect((await useTaskListStore.getState().moveTasks("/source.json", "/dest.json", new Set(["task"]))).status).toBe("success");
  commitParkedFields(); await Promise.all([...docs.keys()].map(drainSerial));
  expect(useTaskListStore.getState().files["/third.json"].data.tasks[0].title).toBe("Third copy");
  expect(useTaskListStore.getState().files["/dest.json"].data.tasks[0].title).toBe("Moved draft");
  expect(useDraftStore.getState().drafts).toEqual({});
});

it("path-specific tab close saves its field despite another matching copy loading first", async () => {
  put("/source.json", list("source")); put("/copy.json", list("copy", "Destination"));
  workspace("/home.json", ["/source.json", "/copy.json"]);
  await openWorkspaceSession("/home.json");
  for (const path of ["/source.json", "/copy.json"]) await useTaskListStore.getState().loadFile(path);
  useDraftStore.getState().setDraft(fieldDraftKey("task", "title", "/copy.json"), "Edited copy");
  await useWorkspaceStore.getState().closeTab(1);
  expect((docs.get("/copy.json")!.data as TaskListDto).tasks[0].title).toBe("Edited copy");
  expect((docs.get("/source.json")!.data as TaskListDto).tasks[0].title).toBe("Original");
  expect(useWorkspaceStore.getState().workspace.openTabs.some((tab) => tab.filePath === "/copy.json")).toBe(false);
  expect(useDraftStore.getState().drafts).toEqual({});
});

it("coalesces focus refreshes behind a held read without delaying an accepted save", async () => {
  const path = "/focus-a.json";
  put(path, list("focus-a")); put("/focus-b.json", list("focus-b"));
  await useTaskListStore.getState().loadFile(path);
  io = [];
  let release!: () => void;
  let reached!: () => void;
  const holding = new Promise<void>((resolve) => { reached = resolve; });
  holdRead = (reading) => reading === path ? new Promise<void>((resolve) => { release = resolve; reached(); }) : Promise.resolve();
  const first = useTaskListStore.getState().refreshFromDisk(path);
  await holding;
  const repeats = Array.from({ length: 30 }, () => useTaskListStore.getState().refreshFromDisk(path));
  const saving = useTaskListStore.getState().updateTitle(path, "task", "Latest edit");
  try {
    await useTaskListStore.getState().loadFile("/focus-b.json");
    expect(io).toEqual([`read:${path}`, "read:/focus-b.json"]);
  } finally { holdRead = undefined; release(); }
  await Promise.all([first, saving, ...repeats]);
  expect(io).toEqual([`read:${path}`, "read:/focus-b.json", `write:${path}`, `read:${path}`]);
  expect(useTaskListStore.getState().files[path]?.data.tasks[0]?.title).toBe("Latest edit");
  await Promise.all([useTaskListStore.getState().unloadFile(path), useTaskListStore.getState().unloadFile("/focus-b.json")]);
});

it("runs a queued refresh, the unload and a reopening load in the list's order", async () => {
  const path = "/focus-retired.json";
  put(path, list("retired")); await useTaskListStore.getState().loadFile(path);
  let release!: () => void;
  let reached!: () => void;
  const holding = new Promise<void>((resolve) => { reached = resolve; });
  holdRead = () => new Promise<void>((resolve) => { release = resolve; reached(); });
  io = [];
  const refresh = useTaskListStore.getState().refreshFromDisk(path);
  await holding;
  const repeat = useTaskListStore.getState().refreshFromDisk(path);
  const retiring = useTaskListStore.getState().unloadFile(path);
  put(path, list("retired", "Reopened data"));
  const reopening = useTaskListStore.getState().loadFile(path);
  holdRead = undefined; release();
  await Promise.all([refresh, repeat, retiring, reopening]);
  expect(io).toEqual([`read:${path}`, `read:${path}`, `read:${path}`]);
  expect(useTaskListStore.getState().files[path]?.data.tasks[0]?.title).toBe("Reopened data");
  await useTaskListStore.getState().unloadFile(path);
});


it("retains a failed coalesced generation for Retry and settles it before tab close", async () => {
  const path = "/coalesced-failed.json";
  put(path, list("coalesced-failed")); workspace("/coalesced-home.json", [path]);
  await openWorkspaceSession("/coalesced-home.json"); await useTaskListStore.getState().loadFile(path);
  failWrites = true;
  await Promise.all(Array.from({ length: 12 }, (_, i) => useTaskListStore.getState().updateTitle(path, "task", `Retry ${i}`)));
  expect(useTaskListStore.getState().unsavedFiles[path]).toBeDefined();
  expect((docs.get(path)!.data as TaskListDto).tasks[0].title).toBe("Original");
  failWrites = false;
  useTaskListStore.getState().retryUnsaved([path]);
  await useWorkspaceStore.getState().closeTab(0);
  expect((docs.get(path)!.data as TaskListDto).tasks[0].title).toBe("Retry 11");
  expect(useTaskListStore.getState().unsavedFiles[path]).toBeUndefined();
  await useTaskListStore.getState().unloadFile(path);
});



