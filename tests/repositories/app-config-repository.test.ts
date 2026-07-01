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

vi.mock("../../src/repositories/file-system", () => ({
  readJsonFileResult: (p: string) => readJsonFileResult(p),
  writeJsonFile: (p: string, d: unknown) => writeJsonFile(p, d),
  ensureDirectory: (p: string) => ensureDirectory(p),
  fileExists: (p: string) => fileExists(p),
  appDataRoot: () => appDataRoot(),
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
    // Existing install re-reads state only; no seed/state files are rewritten.
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
});
