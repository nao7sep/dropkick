import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the file-system layer so we control exactly what is on disk and can
// observe every path the repository reads and writes. This lets us pin the
// storage filenames — the app-level state file and the two seeded user
// documents — without touching a real ~/.dropkick.
const readJsonFileResult = vi.fn();
const writeJsonFile = vi.fn();
const ensureDirectory = vi.fn();
const fileExists = vi.fn();
const appPaths = vi.fn();
const quarantineFile = vi.fn();

vi.mock("../../src/repositories/file-system", () => ({
  readJsonFileResult: (p: string) => readJsonFileResult(p),
  writeJsonFile: (p: string, d: unknown) => writeJsonFile(p, d),
  ensureDirectory: (p: string) => ensureDirectory(p),
  fileExists: (p: string) => fileExists(p),
  appPaths: () => appPaths(),
  quarantineFile: (p: string) => quarantineFile(p),
  withSerial: (_p: string, fn: () => unknown) => fn(),
}));

// Silence logging; it is not under test here.
vi.mock("../../src/repositories/logging", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initializeAppState } from "../../src/repositories/app-state-repository";

const ROOT = "/home/tester/.dropkick";

beforeEach(() => {
  readJsonFileResult.mockReset();
  writeJsonFile.mockReset();
  ensureDirectory.mockReset();
  fileExists.mockReset();
  appPaths.mockReset();
  quarantineFile.mockReset();
  appPaths.mockResolvedValue({
    root: ROOT,
    stateFile: `${ROOT}/state.json`,
    preferencesFile: `${ROOT}/preferences.json`,
    workspaceFile: `${ROOT}/workspace.json`,
    noteDraftsFile: `${ROOT}/note-drafts.json`,
    logsDir: `${ROOT}/logs`,
    backupsFile: `${ROOT}/backups.sqlite3`,
  });
  ensureDirectory.mockResolvedValue(undefined);
  writeJsonFile.mockResolvedValue(undefined);
});

describe("app-level storage filenames", () => {
  it("reads and writes app state from state.json — never app.json or a config.json", async () => {
    // Fresh install: no state file yet, so both seed files get created too.
    readJsonFileResult.mockResolvedValue({ status: "missing" });
    fileExists.mockResolvedValue(false);

    const { appState, statePath } = await initializeAppState();

    // The single app-level file is state.json (state, not config): one file,
    // one role. There is deliberately no config.json — every field is
    // rebuildable, so the config/state split collapses to state-only.
    expect(statePath).toBe(`${ROOT}/state.json`);

    const writtenPaths = writeJsonFile.mock.calls.map((c) => c[0]);
    expect(writtenPaths).toContain(`${ROOT}/state.json`);
    expect(writtenPaths).not.toContain(`${ROOT}/app.json`);
    expect(writtenPaths).not.toContain(`${ROOT}/config.json`);
    expect(appState.lastLaunchedPreferencesPath).toBe("");
  });

  it("seeds the default user documents without the redundant default- prefix", async () => {
    readJsonFileResult.mockResolvedValue({ status: "missing" });
    fileExists.mockResolvedValue(false);

    await initializeAppState();

    const writtenPaths = writeJsonFile.mock.calls.map((c) => c[0]);
    // The seeded default preferences/workspace live at the root under their
    // plain names — "default" is conveyed by their placement, not the filename.
    expect(writtenPaths).toContain(`${ROOT}/preferences.json`);
    expect(writtenPaths).toContain(`${ROOT}/workspace.json`);
    expect(writtenPaths).not.toContain(`${ROOT}/default-preferences.json`);
    expect(writtenPaths).not.toContain(`${ROOT}/default-workspace.json`);
  });

  it("loads existing state from state.json and keeps roles unmerged", async () => {
    // An existing install: state.json is read back; the seed files already
    // exist and must not be recreated.
    fileExists.mockResolvedValue(true);
    readJsonFileResult.mockImplementation((p: string) => {
      if (p === `${ROOT}/state.json`) {
        return Promise.resolve({
          status: "success",
          data: {
            version: "1.0.0",
            lastPreferencesPath: "/x/preferences.json",
            lastWorkspacePath: "/x/workspace.json",
            knownPreferences: ["/x/preferences.json"],
            knownWorkspaces: ["/x/workspace.json"],
          },
        });
      }
      return Promise.resolve({ status: "missing" });
    });

    const { appState, statePath } = await initializeAppState();

    // Read comes from state.json, and the state role (known/recent lists +
    // last selection) is intact — not merged with any durable-config file.
    expect(statePath).toBe(`${ROOT}/state.json`);
    expect(appState.lastPreferencesPath).toBe("/x/preferences.json");
    expect(appState.lastLaunchedPreferencesPath).toBe(
      "/x/preferences.json",
    );
    expect(appState.knownWorkspaces).toEqual(["/x/workspace.json"]);
    // A state.json written before zoom/sidebar became view state has neither
    // field; the load boundary fills both from defaults (mergeWithDefaults), so
    // the migration from preferences.json needs no explicit code.
    expect(appState.zoomLevel).toBe(1.0);
    expect(appState.sidebarWidth).toBe(320);
    // Existing install re-reads state only; no seed/state files are rewritten.
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("preserves stored zoom and sidebar view-state values", async () => {
    // View state (zoom, sidebar width) now lives in state.json, not the portable
    // preferences file. A stored value must survive the load unchanged.
    fileExists.mockResolvedValue(true);
    readJsonFileResult.mockImplementation((p: string) => {
      if (p === `${ROOT}/state.json`) {
        return Promise.resolve({
          status: "success",
          data: {
            version: "1.0.0",
            lastPreferencesPath: "/x/preferences.json",
            lastWorkspacePath: "/x/workspace.json",
            knownPreferences: ["/x/preferences.json"],
            knownWorkspaces: ["/x/workspace.json"],
            zoomLevel: 1.5,
            sidebarWidth: 440,
          },
        });
      }
      return Promise.resolve({ status: "missing" });
    });

    const { appState } = await initializeAppState();
    expect(appState.zoomLevel).toBe(1.5);
    expect(appState.sidebarWidth).toBe(440);
  });
});

describe("corrupt state.json", () => {
  it("quarantines the corrupt file, then recreates defaults (never resets in place)", async () => {
    // Present but unparseable: the load quarantines it aside and proceeds with
    // a rebuilt default state — being unable to launch over rebuildable view
    // state would be the worse failure (storage-path conventions).
    readJsonFileResult.mockResolvedValue({ status: "invalid", message: "bad json" });
    fileExists.mockResolvedValue(true); // seed files exist; must not be recreated
    quarantineFile.mockResolvedValue(`${ROOT}/state-20260817-000000-000-utc.invalid`);

    const { appState, statePath } = await initializeAppState();

    expect(quarantineFile).toHaveBeenCalledWith(`${ROOT}/state.json`);
    expect(statePath).toBe(`${ROOT}/state.json`);
    const writtenPaths = writeJsonFile.mock.calls.map((c) => c[0]);
    expect(writtenPaths).toContain(`${ROOT}/state.json`);
    expect(writtenPaths).not.toContain(`${ROOT}/preferences.json`);
    expect(writtenPaths).not.toContain(`${ROOT}/workspace.json`);
    expect(appState.lastPreferencesPath).toBe(`${ROOT}/preferences.json`);
    expect(appState.knownWorkspaces).toEqual([`${ROOT}/workspace.json`]);
  });

  it("halts when the quarantine rename itself fails — never defaults over the bytes", async () => {
    readJsonFileResult.mockResolvedValue({ status: "invalid", message: "bad json" });
    fileExists.mockResolvedValue(true);
    quarantineFile.mockRejectedValue(new Error("permission denied"));

    await expect(initializeAppState()).rejects.toThrow("permission denied");
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("still halts on a plain read error — an unreadable file is not corrupt", async () => {
    readJsonFileResult.mockResolvedValue({ status: "error", message: "EACCES" });

    await expect(initializeAppState()).rejects.toThrow("Failed to load app appState: EACCES");
    expect(quarantineFile).not.toHaveBeenCalled();
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
});

describe("seeding the built-in default documents", () => {
  it("re-materializes a default document deleted on its own", async () => {
    // Gating this on state.json's absence meant deleting
    // ~/.dropkick/preferences.json alone left it gone for good: state.json
    // survived, so nothing re-created it, while knownPreferences still listed
    // it and Launch dead-ended at "could not be found".
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: {
        version: "1.0.0",
        lastPreferencesPath: `${ROOT}/preferences.json`,
        lastWorkspacePath: `${ROOT}/workspace.json`,
        knownPreferences: [`${ROOT}/preferences.json`],
        knownWorkspaces: [`${ROOT}/workspace.json`],
      },
    });
    // The workspace is still there; only the preferences file went missing.
    fileExists.mockImplementation(async (path: string) =>
      path !== `${ROOT}/preferences.json`,
    );

    await initializeAppState();

    const written = writeJsonFile.mock.calls.map((c) => c[0]);
    expect(written).toContain(`${ROOT}/preferences.json`);
    expect(written).not.toContain(`${ROOT}/workspace.json`);
  });

  it("writes nothing when both default documents are present", async () => {
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: {
        version: "1.0.0",
        lastPreferencesPath: "",
        lastWorkspacePath: "",
        knownPreferences: [],
        knownWorkspaces: [],
      },
    });
    fileExists.mockResolvedValue(true);

    await initializeAppState();

    expect(writeJsonFile).not.toHaveBeenCalled();
  });
});

describe("shape-damaged state.json", () => {
  it.each([
    ["a null root", null],
    ["a list containing a non-path value", { knownPreferences: [{}] }],
    ["a wrong-typed view-state value", { zoomLevel: "large" }],
  ])("quarantines %s before the value reaches the app", async (_label, data) => {
    readJsonFileResult.mockResolvedValue({ status: "success", data });
    fileExists.mockResolvedValue(true);
    quarantineFile.mockResolvedValue(`${ROOT}/state-20260817-000000-000-utc.invalid`);

    const { appState, quarantinedTo } = await initializeAppState();

    expect(quarantineFile).toHaveBeenCalledWith(`${ROOT}/state.json`);
    expect(appState).toEqual(expect.objectContaining({
      knownPreferences: [`${ROOT}/preferences.json`],
      knownWorkspaces: [`${ROOT}/workspace.json`],
      zoomLevel: 1,
    }));
    expect(quarantinedTo).toBe(`${ROOT}/state-20260817-000000-000-utc.invalid`);
  });

  it("quarantines a wrong-typed known-list and rebuilds, instead of crashing the picker", async () => {
    // The file PARSES, so the invalid-status branch never fires; without a shape
    // check mergeWithDefaults passes the string through and StartupPicker throws
    // `items.map is not a function` with no ErrorBoundary above it — a blank window
    // on every launch, and no .invalid file.
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: {
        version: "1.0.0",
        lastPreferencesPath: "/x/preferences.json",
        lastWorkspacePath: "/x/workspace.json",
        knownPreferences: ["/x/preferences.json"],
        knownWorkspaces: "/x/workspace.json", // a string where a list belongs
      },
    });
    fileExists.mockResolvedValue(true);
    quarantineFile.mockResolvedValue(`${ROOT}/state-20260817-000000-000-utc.invalid`);

    const { appState, quarantinedTo } = await initializeAppState();

    expect(quarantineFile).toHaveBeenCalledWith(`${ROOT}/state.json`);
    expect(Array.isArray(appState.knownWorkspaces)).toBe(true);
    expect(appState.knownWorkspaces).toEqual([`${ROOT}/workspace.json`]);
    expect(quarantinedTo).toBe(`${ROOT}/state-20260817-000000-000-utc.invalid`);
    expect(writeJsonFile.mock.calls.map((c) => c[0])).toContain(`${ROOT}/state.json`);
  });

  it("recreates missing default documents through the same recovery path", async () => {
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { knownWorkspaces: "wrong" },
    });
    fileExists.mockResolvedValue(false);
    quarantineFile.mockResolvedValue(`${ROOT}/state-20260817-000000-000-utc.invalid`);

    await initializeAppState();

    expect(writeJsonFile.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining([
      `${ROOT}/preferences.json`,
      `${ROOT}/workspace.json`,
      `${ROOT}/state.json`,
    ]));
  });

  it("leaves a sound state.json alone", async () => {
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: {
        version: "1.0.0",
        lastPreferencesPath: "/x/preferences.json",
        lastWorkspacePath: "/x/workspace.json",
        knownPreferences: ["/x/preferences.json"],
        knownWorkspaces: ["/x/workspace.json"],
      },
    });
    fileExists.mockResolvedValue(true);

    await initializeAppState();
    expect(quarantineFile).not.toHaveBeenCalled();
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
});
