import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { createInitialDocuments, getSuggestedSetupDirectory } from "../../src/repositories/first-run";
import { drainAllSerial, pendingSerialKeys } from "../../src/repositories/file-system";

const names = { workspace: "作業", taskList: "タスク" };
const paths = { workspacePath: "/chosen/workspace.json", taskListPath: "/chosen/tasks.json" };
beforeEach(() => { vi.mocked(invoke).mockReset(); });

describe("first-run documents", () => {
  it("gets the native Documents suggestion without creating anything", async () => {
    vi.mocked(invoke).mockResolvedValue("/documents/Dropkick");
    expect(await getSuggestedSetupDirectory()).toBe("/documents/Dropkick");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("suggested_setup_directory");
  });

  it.each([true, false])("supplies ordinary sparse documents and localized names (task list: %s)", async (includeTasks) => {
    vi.mocked(invoke).mockResolvedValue(paths);
    expect(await createInitialDocuments("/chosen", includeTasks, names)).toEqual(paths);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("create_initial_documents", {
      directory: "/chosen",
      workspace: { formatVersion: 1, id: expect.any(String), name: names.workspace, openTabs: [], recentFiles: [] },
      taskList: includeTasks ? { formatVersion: 1, id: expect.any(String), tasks: [] } : null,
      taskListName: names.taskList,
    });
  });

  it("registers the entire setup before awaiting and keeps quit draining through real settlement", async () => {
    let finish!: (value: typeof paths) => void;
    let entered!: () => void;
    const called = new Promise<void>((resolve) => { entered = resolve; });
    vi.mocked(invoke).mockImplementation(() => {
      entered();
      return new Promise((resolve) => { finish = resolve; });
    });
    const setup = createInitialDocuments("/chosen", true, names);
    expect(pendingSerialKeys()).toContain("/chosen");
    let drained = false;
    const drain = drainAllSerial().then(() => { drained = true; });
    await called;
    expect(drained).toBe(false);
    finish(paths);
    await Promise.all([setup, drain]);
    expect(drained).toBe(true);
    expect(pendingSerialKeys()).not.toContain("/chosen");
  });

  it("propagates a native failure without deleting partial files or blocking a retry", async () => {
    const failure = { code: "occupied" };
    vi.mocked(invoke).mockRejectedValueOnce(failure).mockResolvedValueOnce(paths);
    await expect(createInitialDocuments("/chosen", true, names)).rejects.toBe(failure);
    await expect(createInitialDocuments("/chosen", true, names)).resolves.toEqual(paths);
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["create_initial_documents", "create_initial_documents"]);
    await drainAllSerial();
  });
});
