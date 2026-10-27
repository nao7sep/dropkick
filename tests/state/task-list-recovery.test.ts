// Exercise the real store, repository, serial chain and in-app dialog owner.
// Only the native filesystem/IPC boundary is replaced.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useTaskListStore } from "../../src/state/task-list-store";
import { useNoteDraftStore } from "../../src/state/note-draft-store";
import { refuseDialogs, useDialogStore } from "../../src/state/dialog-store";
import { drainSerial } from "../../src/repositories/file-system";
import { makeTask } from "../helpers/task";
import type { TaskListDto } from "../../src/models";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const PATH = "/recovery.json";
let disk: TaskListDto;
let hash: string | null;
let invalid = false;
let writes: TaskListDto[];

beforeEach(async () => {
  refuseDialogs(false);
  useDialogStore.setState({ current: null, queue: [] });
  useTaskListStore.setState({ files: {}, unsavedFiles: {}, fileLoadErrors: {}, fileDiskErrors: {} });
  useNoteDraftStore.setState({ drafts: {}, editedAtUtc: {}, draftVersions: {}, parkedTasks: {} });
  disk = { id: "L", tasks: [makeTask({ id: "t", title: "Original" })] };
  hash = "original";
  invalid = false;
  writes = [];
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "read_json_file_with_hash") {
      if (hash === null) return { status: "missing" };
      if (invalid) return { status: "invalid", message: "bad JSON" };
      return { status: "success", hash, data: structuredClone(disk) };
    }
    if (command === "save_task_file" || command === "write_text_file_atomic") {
      if (command === "save_task_file") {
        if (hash === null) return { status: "missing" };
        if (hash !== (args as { expectedHash: string }).expectedHash) return { status: "conflict" };
      }
      disk = JSON.parse((args as { contents: string }).contents) as TaskListDto;
      writes.push(structuredClone(disk));
      hash = `saved-${writes.length}`;
      return command === "save_task_file" ? { status: "saved", hash } : hash;
    }
    return undefined;
  });
  await useTaskListStore.getState().loadFile(PATH);
});

afterEach(async () => {
  refuseDialogs(true);
  await drainSerial(PATH);
  refuseDialogs(false);
});

async function question() {
  await vi.waitFor(() => expect(useDialogStore.getState().current?.kind).toBe("confirm"));
}
function title() { return useTaskListStore.getState().files[PATH].data.tasks[0].title; }

it("retains an edit after cancelled recreation and saves it on Retry", async () => {
  hash = null;
  const saving = useTaskListStore.getState().updateTitle(PATH, "t", "Retained");
  await question();
  useDialogStore.getState().cancelCurrent();
  await saving;
  expect(title()).toBe("Retained");
  expect(useTaskListStore.getState().unsavedPaths()).toEqual([PATH]);
  expect(writes).toEqual([]);
  useTaskListStore.getState().retryUnsaved();
  await question();
  useDialogStore.getState().confirmCurrent();
  await drainSerial(PATH);
  expect(disk.tasks[0].title).toBe("Retained");
  expect(useTaskListStore.getState().unsavedPaths()).toEqual([]);
});

it("retains the edit when chosen Reload fails, then saves after disk recovers", async () => {
  hash = "outside";
  const saving = useTaskListStore.getState().updateTitle(PATH, "t", "Retained");
  await question();
  invalid = true;
  useDialogStore.getState().cancelCurrent(); // explicit Discard & Reload
  await saving;
  expect(title()).toBe("Retained");
  expect(useTaskListStore.getState().unsavedPaths()).toEqual([PATH]);
  invalid = false;
  hash = "original";
  useTaskListStore.getState().retryUnsaved();
  await drainSerial(PATH);
  expect(disk.tasks[0].title).toBe("Retained");
  expect(useTaskListStore.getState().unsavedPaths()).toEqual([]);
});

describe.each([false, true])("OS withdrawal, dialogs already refused: %s", (alreadyRefused) => {
  it("never chooses Reload and remains retryable if the session continues", async () => {
    hash = "outside";
    disk.tasks[0].title = "Outside";
    if (alreadyRefused) refuseDialogs(true);
    const saving = useTaskListStore.getState().updateTitle(PATH, "t", "Retained");
    if (!alreadyRefused) {
      await question();
      refuseDialogs(true);
    }
    await saving;
    expect(useDialogStore.getState().current).toBeNull();
    expect(title()).toBe("Retained");
    expect(disk.tasks[0].title).toBe("Outside");
    expect(writes).toEqual([]);
    expect(useTaskListStore.getState().unsavedPaths()).toEqual([PATH]);
    refuseDialogs(false); // Windows allowed the session to continue.
    useTaskListStore.getState().retryUnsaved();
    await question();
    useDialogStore.getState().confirmCurrent();
    await drainSerial(PATH);
    expect(disk.tasks[0].title).toBe("Retained");
    expect(useTaskListStore.getState().unsavedPaths()).toEqual([]);
  });
});


it("still reloads when the user explicitly chooses Discard & Reload", async () => {
  hash = "outside";
  disk.tasks[0].title = "Outside";
  const saving = useTaskListStore.getState().updateTitle(PATH, "t", "Local");
  await question();
  useDialogStore.getState().cancelCurrent();
  await saving;
  expect(title()).toBe("Outside");
  expect(writes).toEqual([]);
  expect(useTaskListStore.getState().unsavedPaths()).toEqual([]);
});

it("keeps the previous comparison hash when a conflict Reload is refused, including Retry", async () => {
  useTaskListStore.setState((state) => ({ files: { ...state.files, "/other.json": { data: { id: "OTHER", tasks: [] } } } }));
  hash = "outside"; disk.id = "OTHER"; disk.tasks[0].title = "External copy";
  const saving = useTaskListStore.getState().updateTitle(PATH, "t", "Retained");
  await question(); useDialogStore.getState().cancelCurrent(); await saving;
  expect(title()).toBe("Retained"); expect(writes).toEqual([]);
  useTaskListStore.getState().retryUnsaved();
  await question();
  expect(writes).toEqual([]);
  refuseDialogs(true); await drainSerial(PATH);
  expect(disk.tasks[0].title).toBe("External copy");
});
