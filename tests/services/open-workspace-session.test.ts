import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ drain: vi.fn(), preferences: vi.fn(), workspace: vi.fn(), save: vi.fn(), adoptPreferences: vi.fn(), adoptWorkspace: vi.fn() }));
vi.mock("../../src/repositories", () => ({ log: { warn: vi.fn(), info: vi.fn() }, loadFailureFields: vi.fn(), drainRequiredSerial: mocks.drain, loadPreferences: mocks.preferences, loadWorkspace: mocks.workspace }));
vi.mock("../../src/state/preferences-store", () => ({ usePreferencesStore: { getState: () => ({ adopt: mocks.adoptPreferences }) } }));
vi.mock("../../src/state/workspace-store", () => ({ useWorkspaceStore: { getState: () => ({ loaded: true, saveBeforeSwitch: mocks.save, adopt: mocks.adoptWorkspace }) } }));
import { openWorkspaceSession } from "../../src/services/open-workspace-session";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.drain.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue(true);
  mocks.preferences.mockResolvedValue({ status: "success", preferences: { name: "Settings" } });
  mocks.workspace.mockResolvedValue({ status: "success", workspace: { name: "Workspace", openTabs: [], recentFiles: [] } });
});
describe("switching a workspace", () => {
  it("keeps the current workspace when the workspace cannot be read", async () => {
    mocks.workspace.mockResolvedValue({ status: "missing" });
    expect(await openWorkspaceSession("w")).toEqual({ kind: "workspace", failure: { status: "missing" } });
    expect(mocks.adoptPreferences).not.toHaveBeenCalled();
    expect(mocks.adoptWorkspace).not.toHaveBeenCalled();
  });
  it("waits for queued work and saves the old workspace before reading the new workspace", async () => {
    let release!: () => void;
    mocks.drain.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const opening = openWorkspaceSession("w");
    expect(mocks.save).not.toHaveBeenCalled();
    release();
    expect(await opening).toEqual({ kind: "success" });
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.workspace.mock.invocationCallOrder[0]);
    expect(mocks.adoptPreferences).not.toHaveBeenCalled();
    expect(mocks.preferences).not.toHaveBeenCalled();
    expect(mocks.adoptWorkspace).toHaveBeenCalledWith("w", { name: "Workspace", openTabs: [], recentFiles: [] });
  });
  it("does not lose current tabs when their save fails, including a dismissed warning", async () => {
    mocks.save.mockResolvedValue(false);
    expect(await openWorkspaceSession("w")).toEqual({ kind: "save" });
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(mocks.adoptPreferences).not.toHaveBeenCalled();
    expect(mocks.adoptWorkspace).not.toHaveBeenCalled();
  });
});
