import { describe, it, expect, beforeEach, vi } from "vitest";
const readJsonFileResult = vi.fn();
const writeJsonFile = vi.fn();
const quarantineFile = vi.fn();
const ROOT = "/home/tester/.dropkick";
vi.mock("../../src/repositories/file-system", () => ({
  readJsonFileResult: (p: string) => readJsonFileResult(p),
  writeJsonFile: (p: string, _format: string, d: unknown, recorded?: boolean) => recorded === undefined ? writeJsonFile(p, d) : writeJsonFile(p, d, recorded),
  ensureDirectory: vi.fn(),
  appPaths: async () => ({ root: ROOT, stateFile: `${ROOT}/state.json` }),
  quarantineFile: (p: string) => quarantineFile(p),
  withSerial: (_p: string, fn: () => unknown) => fn(),
}));
const warn = vi.fn();
vi.mock("../../src/repositories/logging", () => ({ log: { info: vi.fn(), warn: (m: string, f: unknown) => warn(m, f) } }));
import { initializeAppState, flushAppState } from "../../src/repositories/app-state-repository";
import { createDefaultAppState } from "../../src/models";

beforeEach(() => {
  readJsonFileResult.mockReset();
  writeJsonFile.mockReset();
  quarantineFile.mockReset().mockResolvedValue(`${ROOT}/state-stamp.invalid`);
  warn.mockReset();
});

const STORED = {
  lastWorkspacePath: "/work.json",
  zoomLevel: 1.5,
  sidebarWidth: 440,
  recordsListWidth: 400,
};

describe("app-level view state", () => {
  it("creates only first-run view state with no selected workspace", async () => {
    readJsonFileResult.mockResolvedValue({ status: "missing" });
    const { appState, statePath } = await initializeAppState();
    expect(statePath).toBe(`${ROOT}/state.json`);
    expect(appState).toEqual(createDefaultAppState());
    const paths = writeJsonFile.mock.calls.map((c) => c[0]);
    expect(paths).toEqual([`${ROOT}/state.json`]);
    expect(writeJsonFile.mock.calls[0][2]).toBe(false);
  });

  it("reads last selections and geometry, leaving unrecognized keys behind", async () => {
    readJsonFileResult.mockResolvedValue({ status: "success", data: {
      ...STORED, unknown: ["/old.json"], knownWorkspaces: "unrecognized",
    } });
    const { appState } = await initializeAppState();
    expect(appState).toEqual(STORED);
    expect(quarantineFile).not.toHaveBeenCalled();
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
    { status: "success", data: null },
    { status: "success", data: { ...STORED, zoomLevel: "large" } },
    { status: "success", data: { ...STORED, zoomLevel: 0 } },
    { status: "success", data: { ...STORED, zoomLevel: 5.1 } },
    { status: "success", data: { ...STORED, lastWorkspacePath: [] } },
    { status: "success", data: {} },
  ])("quarantines damaged or incomplete state before recreating view defaults", async (result) => {
    readJsonFileResult.mockResolvedValue(result);
    const { appState } = await initializeAppState();
    expect(quarantineFile).toHaveBeenCalledWith(`${ROOT}/state.json`);
    expect(appState.zoomLevel).toBe(1);
    expect("knownWorkspaces" in appState).toBe(false);
    expect(writeJsonFile).toHaveBeenCalledWith(`${ROOT}/state.json`, appState, false);
  });

  it.each([
    [{ status: "invalid", message: "bad JSON" }, { error: { message: "bad JSON" } }],
    [{ status: "success", data: { ...STORED, zoomLevel: "large" } }, { issue: "zoomLevel is not a finite number" }],
  ])("records a reset state file with its reason", async (result, reason) => {
    readJsonFileResult.mockResolvedValue(result);
    await initializeAppState();
    expect(warn).toHaveBeenCalledExactlyOnceWith("state.json reset", {
      statePath: `${ROOT}/state.json`,
      quarantinedTo: `${ROOT}/state-stamp.invalid`,
      ...reason,
    });
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
