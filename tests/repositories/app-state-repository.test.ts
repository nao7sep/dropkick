import { describe, it, expect, beforeEach, vi } from "vitest";
const readJsonFileResult = vi.fn();
const writeJsonFile = vi.fn();
const fileExists = vi.fn();
const quarantineFile = vi.fn();
const ROOT = "/home/tester/.dropkick";
vi.mock("../../src/repositories/file-system", () => ({
  readJsonFileResult: (p: string) => readJsonFileResult(p),
  writeJsonFile: (p: string, d: unknown, recorded?: boolean) => recorded === undefined ? writeJsonFile(p, d) : writeJsonFile(p, d, recorded),
  ensureDirectory: vi.fn(),
  fileExists: (p: string) => fileExists(p),
  appPaths: async () => ({ root: ROOT, stateFile: `${ROOT}/state.json`, configFile: `${ROOT}/config.json`, preferencesFile: `${ROOT}/preferences.json`, workspaceFile: `${ROOT}/workspace.json` }),
  quarantineFile: (p: string) => quarantineFile(p),
  withSerial: (_p: string, fn: () => unknown) => fn(),
}));
vi.mock("../../src/repositories/logging", () => ({ log: { info: vi.fn(), warn: vi.fn() } }));
import { initializeAppState, flushAppState } from "../../src/repositories/app-state-repository";
import { createDefaultAppState } from "../../src/models";

beforeEach(() => {
  readJsonFileResult.mockReset();
  writeJsonFile.mockReset();
  fileExists.mockReset().mockResolvedValue(true);
  quarantineFile.mockReset().mockResolvedValue(`${ROOT}/state-stamp.invalid`);
});

describe("app-level view state", () => {
  it("creates first-run state and default documents without a config file or known-document lists", async () => {
    readJsonFileResult.mockResolvedValue({ status: "missing" });
    fileExists.mockResolvedValue(false);
    const { appState, statePath } = await initializeAppState();
    expect(statePath).toBe(`${ROOT}/state.json`);
    expect(appState).toEqual({ ...createDefaultAppState(), lastPreferencesPath: `${ROOT}/preferences.json`, lastWorkspacePath: `${ROOT}/workspace.json` });
    const paths = writeJsonFile.mock.calls.map((c) => c[0]);
    expect(paths).toEqual([`${ROOT}/state.json`, `${ROOT}/preferences.json`, `${ROOT}/workspace.json`]);
    expect(writeJsonFile.mock.calls[0][2]).toBe(false);
    expect(writeJsonFile.mock.calls[1][1]).toEqual({ id: expect.any(String), name: "Default" });
  });

  it("reads last selections and geometry while dropping obsolete known-document lists", async () => {
    readJsonFileResult.mockResolvedValue({ status: "success", data: {
      version: "1.0.0", lastPreferencesPath: "/selected.json", lastWorkspacePath: "/work.json",
      knownPreferences: ["/old.json"], knownWorkspaces: "obsolete wrong shape", zoomLevel: 1.5, sidebarWidth: 440,
    } });
    const { appState } = await initializeAppState();
    expect(appState).toEqual({ ...createDefaultAppState(), lastPreferencesPath: "/selected.json", lastLaunchedPreferencesPath: "/selected.json", lastWorkspacePath: "/work.json", zoomLevel: 1.5, sidebarWidth: 440 });
    expect(quarantineFile).not.toHaveBeenCalled();
    expect(writeJsonFile).not.toHaveBeenCalled();
    await flushAppState(`${ROOT}/state.json`, () => appState);
    expect(writeJsonFile).toHaveBeenCalledWith(`${ROOT}/state.json`, appState, false);
    expect("knownPreferences" in writeJsonFile.mock.calls[0][1]).toBe(false);
  });

  it("recreates only a missing default preferences document, with identity only", async () => {
    readJsonFileResult.mockResolvedValue({ status: "success", data: {} });
    fileExists.mockImplementation(async (path: string) => path !== `${ROOT}/preferences.json`);
    await initializeAppState();
    expect(writeJsonFile).toHaveBeenCalledOnce();
    expect(writeJsonFile).toHaveBeenCalledWith(`${ROOT}/preferences.json`, { id: expect.any(String), name: "Default" });
  });

  it.each([
    { status: "invalid", message: "bad JSON" },
    { status: "success", data: null },
    { status: "success", data: { zoomLevel: "large" } },
    { status: "success", data: { lastWorkspacePath: [] } },
  ])("quarantines damaged state before recreating view defaults", async (result) => {
    readJsonFileResult.mockResolvedValue(result);
    const { appState, quarantinedTo } = await initializeAppState();
    expect(quarantineFile).toHaveBeenCalledWith(`${ROOT}/state.json`);
    expect(quarantinedTo).toBe(`${ROOT}/state-stamp.invalid`);
    expect(appState.zoomLevel).toBe(1);
    expect("knownWorkspaces" in appState).toBe(false);
    expect(writeJsonFile).toHaveBeenCalledWith(`${ROOT}/state.json`, appState, false);
  });

  it("halts after a failed quarantine without replacing preserved bytes", async () => {
    readJsonFileResult.mockResolvedValue({ status: "invalid", message: "bad JSON" });
    quarantineFile.mockRejectedValue(new Error("permission denied"));
    await expect(initializeAppState()).rejects.toThrow("permission denied");
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("halts on a read error without writing any files", async () => {
    readJsonFileResult.mockResolvedValue({ status: "error", message: "EACCES" });
    await expect(initializeAppState()).rejects.toThrow("EACCES");
    expect(quarantineFile).not.toHaveBeenCalled();
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
});
