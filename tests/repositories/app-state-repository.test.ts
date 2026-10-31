import { describe, it, expect, beforeEach, vi } from "vitest";
const readJsonFileResult = vi.fn();
const writeJsonFile = vi.fn();
const ROOT = "/home/tester/.dropkick";
vi.mock("../../src/repositories/file-system", () => ({
  readJsonFileResult: (p: string) => readJsonFileResult(p),
  writeJsonFile: (p: string, _format: string, d: unknown, recorded?: boolean) => recorded === undefined ? writeJsonFile(p, d) : writeJsonFile(p, d, recorded),
  ensureDirectory: vi.fn(),
  appPaths: async () => ({ root: ROOT, stateFile: `${ROOT}/state.json` }),
  withSerial: (_p: string, fn: () => unknown) => fn(),
}));
const warn = vi.fn();
vi.mock("../../src/repositories/logging", () => ({ log: { info: vi.fn(), warn: (m: string, f: unknown) => warn(m, f) } }));
import { initializeAppState, flushAppState } from "../../src/repositories/app-state-repository";
import { createDefaultAppState } from "../../src/models";

beforeEach(() => {
  readJsonFileResult.mockReset();
  writeJsonFile.mockReset();
  warn.mockReset();
});

const STORED = {
  lastWorkspacePath: "/work.json",
  zoomLevel: 1.5,
  sidebarWidth: 440,
  recordsListWidth: 400,
};

describe("app-level view state", () => {
  it("starts first-run view state with no selected workspace, writing nothing", async () => {
    readJsonFileResult.mockResolvedValue({ status: "missing" });
    const { appState, statePath, refusal } = await initializeAppState();
    expect(statePath).toBe(`${ROOT}/state.json`);
    expect(appState).toEqual(createDefaultAppState());
    expect(refusal).toBeNull();
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("reads last selections and geometry, leaving unrecognized keys behind", async () => {
    readJsonFileResult.mockResolvedValue({ status: "success", data: {
      ...STORED, unknown: ["/old.json"], knownWorkspaces: "unrecognized",
    } });
    const { appState } = await initializeAppState();
    expect(appState).toEqual(STORED);
    expect(writeJsonFile).not.toHaveBeenCalled();
    await flushAppState(`${ROOT}/state.json`, () => appState);
    expect(writeJsonFile).toHaveBeenCalledWith(`${ROOT}/state.json`, appState, false);
    expect("unknown" in writeJsonFile.mock.calls[0][1]).toBe(false);
  });

  it("keeps saved selections without recreating missing documents", async () => {
    readJsonFileResult.mockResolvedValue({ status: "success", data: STORED });
    expect((await initializeAppState()).appState).toEqual(STORED);
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it.each([
    { status: "invalid", message: "bad JSON" },
    { status: "error", message: "EACCES" },
    { status: "success", data: null },
    { status: "success", data: { ...STORED, zoomLevel: "large" } },
    { status: "success", data: { ...STORED, zoomLevel: 0 } },
    { status: "success", data: { ...STORED, zoomLevel: 5.1 } },
    { status: "success", data: { ...STORED, lastWorkspacePath: [] } },
    { status: "success", data: {} },
  ])("takes the view defaults for unreadable state, leaving the file for the next save (%j)", async (result) => {
    readJsonFileResult.mockResolvedValue(result);
    const { appState, statePath, refusal } = await initializeAppState();
    expect(appState).toEqual(createDefaultAppState());
    expect(statePath).toBe(`${ROOT}/state.json`);
    expect(refusal).toBeNull();
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "invalid", message: "bad JSON" }, { error: { message: "bad JSON" } }],
    [{ status: "success", data: { ...STORED, zoomLevel: "large" } }, { issue: "zoomLevel is not a finite number" }],
  ])("records why the state was not used", async (result, reason) => {
    readJsonFileResult.mockResolvedValue(result);
    await initializeAppState();
    expect(warn).toHaveBeenCalledExactlyOnceWith("state.json is unreadable; using the defaults", {
      statePath: `${ROOT}/state.json`,
      ...reason,
    });
  });

  it("refuses a newer state.json for the launch, with no file to write", async () => {
    readJsonFileResult.mockResolvedValue({ status: "newer", formatVersion: 2 });
    const { appState, statePath, refusal } = await initializeAppState();
    expect(appState).toEqual(createDefaultAppState());
    expect(statePath).toBe("");
    expect(refusal).toEqual({ path: `${ROOT}/state.json`, reason: "newer" });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
});
