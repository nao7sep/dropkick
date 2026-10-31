// Real mutation/repository/serial owners; the native disk is the only substitute.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useTaskListStore } from "../../src/state/task-list-store";
import { useDraftStore } from "../../src/state/draft-store";
import { useDialogStore, refuseDialogs } from "../../src/state/dialog-store";
import { drainSerial } from "../../src/repositories/file-system";
import { commitParkedFields } from "../../src/services/commit-task-fields";
import { deleteSelectedTasks } from "../../src/services/task-deletion";
import { composerDraftKey, editorDraftKey, fieldDraftKey, unsavedNoteText } from "../../src/services/drafts";
import { toTask } from "../../src/utils/domain-mapping";
import { makeTask, makeNote } from "../helpers/task";
import type { TaskListDto } from "../../src/models";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const A = "/a.json", B = "/b.json", C = "/c.json";
let docs: Map<string, { data: TaskListDto; hash: string }>;
let held: (() => Promise<void>) | undefined;
let fail: boolean;
beforeEach(async () => {
  refuseDialogs(false); useDialogStore.setState({ current: null, queue: [] });
  useTaskListStore.setState({ files: {}, unsavedFiles: {}, fileLoadErrors: {}, fileDiskErrors: {}, selectedKeys: new Set() });
  useDraftStore.setState({ drafts: {}, draftVersions: {}, editedAtUtc: {}, parkedTasks: {} });
  docs = new Map([A, B, C].map((path) => [path, { hash: `initial-${path}`, data: { id: path,
    tasks: [makeTask({ id: "same", title: path, notes: [makeNote({ id: "note", content: `saved-${path}` })] })],
  } }]));
  held = undefined; fail = false;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const { path, contents } = (args ?? {}) as { path: string; contents: string };
    if (command === "read_json_file_with_hash") return { status: "success", ...structuredClone(docs.get(path)) };
    if (command === "write_text_file_atomic" || command === "save_task_file") {
      if (command === "save_task_file") {
        const current = docs.get(path)?.hash;
        if (current === undefined) return { status: "missing" };
        if (current !== (args as { expectedHash: string }).expectedHash) return { status: "conflict" };
      }
      await held?.(); if (fail) throw new Error("disk full");
      docs.set(path, { data: JSON.parse(contents), hash: contents }); return command === "save_task_file" ? { status: "saved", hash: contents } : contents;
    }
  });
});
afterEach(async () => { refuseDialogs(true); await Promise.all([A, B, C].map(drainSerial)); refuseDialogs(false); });
async function load(paths = [A, B]) { for (const path of paths) await useTaskListStore.getState().loadFile(path); }

it.each([false, true])("independently parked fields commit to both copies regardless of loaded order (%s)", async (reverse) => {
  await load(reverse ? [B, A] : [A, B]);
  for (const path of [A, B]) {
    useDraftStore.getState().setDraft(fieldDraftKey("same", "title", path), `edited-${path}`);
    useDraftStore.getState().setDraft(fieldDraftKey("same", "description", path), `description-${path}`);
  }
  commitParkedFields(); await Promise.all([A, B, C].map(drainSerial));
  for (const path of [A, B]) {
    expect(docs.get(path)!.data.tasks[0].title).toBe(`edited-${path}`);
    expect(docs.get(path)!.data.tasks[0].description).toBe(`description-${path}`);
  }
  expect(useDraftStore.getState().drafts).toEqual({});
});

it("closing one note copy retains both independently authored drafts and their names", async () => {
  await load();
  for (const path of [A, B]) {
    useDraftStore.getState().setDraft(editorDraftKey("same", "note", path), `edited-${path}`);
    useDraftStore.getState().setDraft(composerDraftKey("same", path), `new-${path}`);
  }
  await useTaskListStore.getState().unloadFile(A);
  useDraftStore.getState().reconcile(Object.entries(useTaskListStore.getState().files).map(([sourceFile, file]) => ({ ...file.data, sourceFile })));
  expect(Object.keys(useDraftStore.getState().drafts)).toHaveLength(4);
  expect(unsavedNoteText(useDraftStore.getState().drafts,
    Object.entries(useTaskListStore.getState().files).map(([sourceFile, file]) => ({ ...file.data, sourceFile })),
    Object.values(useDraftStore.getState().parkedTasks)).taskTitles.sort()).toEqual([A, B]);
});

it("a delayed delete of B never retires newer drafts on surviving A", async () => {
  await load();
  let release!: () => void;
  let reached!: () => void;
  const holding = new Promise<void>((resolve) => { reached = resolve; });
  held = () => new Promise<void>((resolve) => { release = resolve; reached(); });
  const deleting = deleteSelectedTasks({ selectedTasks: [toTask(docs.get(B)!.data.tasks[0], B, "UTC", 7)],
    removeTasks: useTaskListStore.getState().removeTasks, clearTaskDrafts: useDraftStore.getState().clearTaskDrafts });
  await holding;
  const keys = [fieldDraftKey("same", "title", A), editorDraftKey("same", "note", A), composerDraftKey("same", A)];
  for (const key of keys) useDraftStore.getState().setDraft(key, "newer A text");
  held = undefined; release(); await deleting;
  for (const key of keys) expect(useDraftStore.getState().drafts[key]).toBe("newer A text");
  expect(useTaskListStore.getState().files[A].data.tasks).toHaveLength(1);
  expect(useTaskListStore.getState().files[B].data.tasks).toEqual([]);
});

it("a failed move retains source drafts; a successful retry transfers all kinds and newer typing only for that copy", async () => {
  docs.set(C, { data: { id: C, tasks: [] }, hash: "empty" }); await load([A, B, C]);
  const sourceKeys = [fieldDraftKey("same", "title", A), composerDraftKey("same", A), editorDraftKey("same", "note", A)];
  for (const key of sourceKeys) useDraftStore.getState().setDraft(key, "A text");
  const other = composerDraftKey("same", B); useDraftStore.getState().setDraft(other, "B text");
  fail = true;
  expect((await useTaskListStore.getState().moveTasks(A, C, new Set(["same"]))).status).toBe("error");
  for (const key of sourceKeys) expect(useDraftStore.getState().drafts[key]).toBe("A text");
  fail = false;
  let release!: () => void;
  let reached!: () => void;
  const holding = new Promise<void>((resolve) => { reached = resolve; });
  held = () => new Promise<void>((resolve) => { release = resolve; reached(); });
  const moving = useTaskListStore.getState().moveTasks(A, C, new Set(["same"]));
  await holding;
  useDraftStore.getState().setDraft(sourceKeys[2], "newer A edit");
  held = undefined; release(); await moving;
  expect(useDraftStore.getState().drafts[editorDraftKey("same", "note", C)]).toBe("newer A edit");
  expect(useDraftStore.getState().drafts[composerDraftKey("same", C)]).toBe("A text");
  expect(useDraftStore.getState().drafts[other]).toBe("B text");
  commitParkedFields(); await Promise.all([A, B, C].map(drainSerial));
  expect(docs.get(C)!.data.tasks[0].title).toBe("A text");
  expect(docs.get(B)!.data.tasks[0].title).toBe(B);
});

it.each(["composer", "editor"] as const)("a %s save receipt follows its draft through a held move", async (kind) => {
  docs.set(C, { data: { id: C, tasks: [] }, hash: "empty" }); await load([A, B, C]);
  const key = kind === "composer" ? composerDraftKey("same", A) : editorDraftKey("same", "note", A);
  const movedKey = kind === "composer" ? composerDraftKey("same", C) : editorDraftKey("same", "note", C);
  useDraftStore.getState().setDraft(key, "submitted text");
  const version = useDraftStore.getState().draftVersions[key];
  let release!: () => void;
  let reached!: () => void;
  const holding = new Promise<void>((resolve) => { reached = resolve; });
  held = () => new Promise<void>((resolve) => { release = resolve; reached(); });
  const moving = useTaskListStore.getState().moveTasks(A, C, new Set(["same"]));
  await holding;
  // TaskDetail captures this receipt before awaiting its real store action.
  const saving = (kind === "composer"
    ? useTaskListStore.getState().addNewNote(A, "same", "submitted text")
    : useTaskListStore.getState().updateNote(A, "same", "note", "submitted text"))
    .then(() => useDraftStore.getState().clearDraftIf(key, "submitted text", version));
  held = undefined; release(); await moving;
  expect(await saving).toBe(true);
  expect(useDraftStore.getState().drafts[movedKey]).toBeUndefined();
  expect(docs.get(C)!.data.tasks[0].notes.filter((note) => note.content === "submitted text")).toHaveLength(1);
});

it("an old move/save receipt preserves newer text on the moved copy and independent copy", async () => {
  docs.set(C, { data: { id: C, tasks: [] }, hash: "empty" }); await load([A, B, C]);
  const key = composerDraftKey("same", A), other = composerDraftKey("same", B);
  useDraftStore.getState().setDraft(key, "submitted text");
  const version = useDraftStore.getState().draftVersions[key];
  let release!: () => void;
  let reached!: () => void;
  const holding = new Promise<void>((resolve) => { reached = resolve; });
  held = () => new Promise<void>((resolve) => { release = resolve; reached(); });
  const moving = useTaskListStore.getState().moveTasks(A, C, new Set(["same"]));
  await holding;
  const saving = useTaskListStore.getState().addNewNote(A, "same", "submitted text")
    .then(() => useDraftStore.getState().clearDraftIf(key, "submitted text", version));
  useDraftStore.getState().setDraft(key, "newer text");
  useDraftStore.getState().setDraft(other, "submitted text");
  held = undefined; release(); await moving; expect(await saving).toBe(false);
  expect(useDraftStore.getState().drafts[composerDraftKey("same", C)]).toBe("newer text");
  expect(useDraftStore.getState().drafts[other]).toBe("submitted text");
});

it("a deletion during a held move retires that subject's drafts instead of transferring orphans", async () => {
  docs.set(C, { data: { id: C, tasks: [] }, hash: "empty" }); await load([A, B, C]);
  useDraftStore.getState().setDraft(composerDraftKey("same", A), "A text");
  const other = composerDraftKey("same", B); useDraftStore.getState().setDraft(other, "B text");
  let release!: () => void;
  let reached!: () => void;
  const holding = new Promise<void>((resolve) => { reached = resolve; });
  held = () => new Promise<void>((resolve) => { release = resolve; reached(); });
  const moving = useTaskListStore.getState().moveTasks(A, C, new Set(["same"]));
  await holding;
  const deleting = deleteSelectedTasks({ selectedTasks: [toTask(docs.get(A)!.data.tasks[0], A, "UTC", 7)],
    removeTasks: useTaskListStore.getState().removeTasks, clearTaskDrafts: useDraftStore.getState().clearTaskDrafts });
  held = undefined; release(); await Promise.all([moving, deleting]);
  expect(docs.get(C)!.data.tasks).toEqual([]);
  expect(useDraftStore.getState().drafts).toEqual({ [other]: "B text" });
});
