import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the file-system layer so we control exactly what is on disk and can
// observe every path the repository reads and writes. This lets us pin the
// storage filenames — the app-level state file and the two seeded user
// documents — without touching a real ~/.dropkick.
const readJsonFileResult = vi.fn();
const writeJsonFile = vi.fn();
const ensureDirectory = vi.fn();
const fileExists = vi.fn();
const appDataRoot = vi.fn();
const quarantineFile = vi.fn();

vi.mock("../../src/repositories/file-system", () => ({
  readJsonFileResult: (p: string) => readJsonFileResult(p),
  writeJsonFile: (p: string, d: unknown) => writeJsonFile(p, d),
  ensureDirectory: (p: string) => ensureDirectory(p),
  fileExists: (p: string) => fileExists(p),
  appDataRoot: () => appDataRoot(),
  quarantineFile: (p: string) => quarantineFile(p),
  // The repository joins with plain "/"; mirror that so asserted paths are stable.
  joinPath: (...parts: string[]) => parts.join("/"),
  withSerial: (_p: string, fn: () => unknown) => fn(),
}));

// Silence logging; it is not under test here.
vi.mock("../../src/repositories/logging", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initializeAppConfig } from "../../src/repositories/app-config-repository";

const ROOT = "/home/tester/.dropkick";

beforeEach(() => {
  readJsonFileResult.mockReset();
  writeJsonFile.mockReset();
  ensureDirectory.mockReset();
  fileExists.mockReset();
  appDataRoot.mockReset();
  quarantineFile.mockReset();
  appDataRoot.mockResolvedValue(ROOT);
  ensureDirectory.mockResolvedValue(undefined);
  writeJsonFile.mockResolvedValue(undefined);
});

describe("app-level storage filenames", () => {
  it("reads and writes app state from state.json — never app.json or a config.json", async () => {
    // Fresh install: no state file yet, so both seed files get created too.
    readJsonFileResult.mockResolvedValue({ status: "missing" });
    fileExists.mockResolvedValue(false);

    const { configPath } = await initializeAppConfig();

    // The single app-level file is state.json (state, not config): one file,
    // one role. There is deliberately no config.json — every field is
    // rebuildable, so the config/state split collapses to state-only.
    expect(configPath).toBe(`${ROOT}/state.json`);

    const writtenPaths = writeJsonFile.mock.calls.map((c) => c[0]);
    expect(writtenPaths).toContain(`${ROOT}/state.json`);
    expect(writtenPaths).not.toContain(`${ROOT}/app.json`);
    expect(writtenPaths).not.toContain(`${ROOT}/config.json`);
  });

  it("seeds the default user documents without the redundant default- prefix", async () => {
    readJsonFileResult.mockResolvedValue({ status: "missing" });
    fileExists.mockResolvedValue(false);

    await initializeAppConfig();

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

    const { config, configPath } = await initializeAppConfig();

    // Read comes from state.json, and the state role (known/recent lists +
    // last selection) is intact — not merged with any durable-config file.
    expect(configPath).toBe(`${ROOT}/state.json`);
    expect(config.lastPreferencesPath).toBe("/x/preferences.json");
    expect(config.knownWorkspaces).toEqual(["/x/workspace.json"]);
    // A state.json written before zoom/sidebar became view state has neither
    // field; the load boundary fills both from defaults (mergeWithDefaults), so
    // the migration from preferences.json needs no explicit code.
    expect(config.zoomLevel).toBe(1.0);
    expect(config.sidebarWidth).toBe(320);
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

    const { config } = await initializeAppConfig();
    expect(config.zoomLevel).toBe(1.5);
    expect(config.sidebarWidth).toBe(440);
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

    const { config, configPath } = await initializeAppConfig();

    expect(quarantineFile).toHaveBeenCalledWith(`${ROOT}/state.json`);
    expect(configPath).toBe(`${ROOT}/state.json`);
    const writtenPaths = writeJsonFile.mock.calls.map((c) => c[0]);
    expect(writtenPaths).toContain(`${ROOT}/state.json`);
    expect(writtenPaths).not.toContain(`${ROOT}/preferences.json`);
    expect(writtenPaths).not.toContain(`${ROOT}/workspace.json`);
    expect(config.lastPreferencesPath).toBe(`${ROOT}/preferences.json`);
    expect(config.knownWorkspaces).toEqual([`${ROOT}/workspace.json`]);
  });

  it("halts when the quarantine rename itself fails — never defaults over the bytes", async () => {
    readJsonFileResult.mockResolvedValue({ status: "invalid", message: "bad json" });
    fileExists.mockResolvedValue(true);
    quarantineFile.mockRejectedValue(new Error("permission denied"));

    await expect(initializeAppConfig()).rejects.toThrow("permission denied");
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("still halts on a plain read error — an unreadable file is not corrupt", async () => {
    readJsonFileResult.mockResolvedValue({ status: "error", message: "EACCES" });

    await expect(initializeAppConfig()).rejects.toThrow("Failed to load app config: EACCES");
    expect(quarantineFile).not.toHaveBeenCalled();
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

    const { config, quarantinedTo } = await initializeAppConfig();

    expect(quarantineFile).toHaveBeenCalledWith(`${ROOT}/state.json`);
    expect(config).toEqual(expect.objectContaining({
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

    const { config, quarantinedTo } = await initializeAppConfig();

    expect(quarantineFile).toHaveBeenCalledWith(`${ROOT}/state.json`);
    expect(Array.isArray(config.knownWorkspaces)).toBe(true);
    expect(config.knownWorkspaces).toEqual([`${ROOT}/workspace.json`]);
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

    await initializeAppConfig();

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

    await initializeAppConfig();
    expect(quarantineFile).not.toHaveBeenCalled();
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
});
