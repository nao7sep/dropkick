// Every store's format version (store-recovery-conventions), driven through the
// real repositories and file-system module against an in-memory disk: a file
// without a marker takes its store's unreadable branch, the current version
// round-trips, and a newer build's file is refused and left byte-identical. The Rust core's own stores and the task-list classifier are
// covered in src-tauri/tests.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { createDefaultSettings, FORMAT_VERSIONS } from "../../src/models";
import { flushAppConfig, loadAppConfig } from "../../src/repositories/app-config-repository";
import { flushAppState, initializeAppState } from "../../src/repositories/app-state-repository";
import { flushSettings, initializeSettings } from "../../src/repositories/settings-repository";
import { flushTaskList, loadTaskList } from "../../src/repositories/task-list-repository";
import { flushWorkspace, loadWorkspace } from "../../src/repositories/workspace-repository";

const ROOT = "/home/u/.dropkick";
const PATHS = {
  root: ROOT,
  stateFile: `${ROOT}/state.json`,
  configFile: `${ROOT}/config.json`,
  settingsFile: `${ROOT}/settings.json`,
  logsDir: `${ROOT}/logs`,
  backupsFile: `${ROOT}/backups.sqlite3`,
  recordsFile: `${ROOT}/records.sqlite3`,
};

const disk = new Map<string, string>();

// The task-list read is the core's; this stand-in answers as its classifier
// does for the documents used here (src-tauri/tests/unit/atomic_write.rs owns it).
function readTaskList(path: string): unknown {
  const text = disk.get(path);
  if (text === undefined) return { status: "missing" };
  const { formatVersion, id = "", tasks } = JSON.parse(text);
  if (formatVersion === undefined) return { status: "invalid", message: "formatVersion is missing" };
  if (formatVersion > FORMAT_VERSIONS.taskList) return { status: "newer", formatVersion };
  return { status: "success", data: { id, tasks }, hash: text };
}

beforeEach(() => {
  disk.clear();
  vi.mocked(invoke).mockReset().mockImplementation(async (command: string, args?: unknown) => {
    const { path, contents } = (args ?? {}) as { path: string; contents: string };
    switch (command) {
      case "app_paths":
        return PATHS;
      case "read_text_file": {
        const text = disk.get(path);
        return text === undefined ? { status: "missing" } : { status: "success", text };
      }
      case "read_json_file_with_hash":
        return readTaskList(path);
      case "file_exists":
        return disk.has(path);
      case "save_task_file": {
        const expected = (args as { expectedHash: string }).expectedHash;
        if (disk.get(path) !== expected) return { status: disk.has(path) ? "conflict" : "missing" };
        disk.set(path, contents);
        return { status: "saved", hash: contents };
      }
      case "write_text_file_atomic":
        disk.set(path, contents);
        return contents;
      case "quarantine_file": {
        const target = `${path}.invalid`;
        disk.set(target, disk.get(path)!);
        disk.delete(path);
        return target;
      }
      default:
        return undefined;
    }
  });
});

function stored(path: string): Record<string, unknown> {
  return JSON.parse(disk.get(path)!);
}

function put(path: string, document: unknown): string {
  const text = JSON.stringify(document);
  disk.set(path, text);
  return text;
}

function writes(): unknown[] {
  return vi.mocked(invoke).mock.calls.filter(([command]) =>
    command === "save_task_file" || command === "write_text_file_atomic" || command === "quarantine_file");
}

function writesTo(path: string): unknown[] {
  return writes().filter((call) => (call as [string, { path: string }])[1].path === path);
}

describe("state.json", () => {
  it("sets aside a file without a marker and starts on the defaults", async () => {
    const text = put(PATHS.stateFile, { zoomLevel: 1.5 });
    const { appState } = await initializeAppState();
    expect(appState.zoomLevel).toBe(1);
    expect(disk.get(`${PATHS.stateFile}.invalid`)).toBe(text);
    expect(stored(PATHS.stateFile).formatVersion).toBe(1);
  });

  it("round-trips the current version", async () => {
    const first = await initializeAppState();
    await flushAppState(first.statePath, () => ({ ...first.appState, zoomLevel: 2 }));
    expect(stored(PATHS.stateFile).formatVersion).toBe(1);
    expect((await initializeAppState()).appState.zoomLevel).toBe(2);
  });

  it("leaves a newer build's file byte-identical and writes nothing over it", async () => {
    const text = put(PATHS.stateFile, { formatVersion: 3, zoomLevel: "large" });
    const { appState, statePath } = await initializeAppState();
    expect(statePath).toBe("");
    expect(appState.zoomLevel).toBe(1);
    expect(disk.get(PATHS.stateFile)).toBe(text);
    expect(writesTo(PATHS.stateFile)).toEqual([]);
  });
});

describe("config.json", () => {
  it("preserves a fresh install's empty lists through its first saved location and restart", async () => {
    const { appState } = await initializeAppState();
    const { appConfig, filePath } = await loadAppConfig();
    expect(appState.lastWorkspacePath).toBe("");
    expect(appConfig).toEqual({ knownWorkspaces: [] });
    expect([...disk.keys()]).toEqual([PATHS.stateFile]);
    await flushAppConfig(filePath, () => ({ ...appConfig, knownWorkspaces: ["/docs/workspace.json"] }));
    expect((await loadAppConfig()).appConfig).toEqual({ knownWorkspaces: ["/docs/workspace.json"] });
  });

  it("quarantines a file without a marker and uses the built-ins", async () => {
    const text = put(PATHS.configFile, { knownWorkspaces: ["/w.json"] });
    const { appConfig, recovery } = await loadAppConfig();
    expect(recovery).toEqual({ kind: "quarantined", quarantinedTo: `${PATHS.configFile}.invalid` });
    expect(appConfig.knownWorkspaces).toEqual([]);
    expect(disk.get(`${PATHS.configFile}.invalid`)).toBe(text);
  });

  it("round-trips the current version", async () => {
    put(PATHS.configFile, { formatVersion: 1, knownWorkspaces: ["/w.json"] });
    const { appConfig, filePath, recovery } = await loadAppConfig();
    expect(recovery).toBeNull();
    expect(appConfig.knownWorkspaces).toEqual(["/w.json"]);
    await flushAppConfig(filePath, () => appConfig);
    expect(stored(PATHS.configFile)).toEqual({ formatVersion: 1, knownWorkspaces: ["/w.json"] });
  });

  it("leaves a newer build's file byte-identical and says so", async () => {
    const text = put(PATHS.configFile, { formatVersion: 3, knownWorkspaces: { "/w.json": {} } });
    const { appConfig, filePath, recovery } = await loadAppConfig();
    expect(recovery).toEqual({ kind: "newer", formatVersion: 3 });
    expect(filePath).toBe("");
    expect(appConfig.knownWorkspaces).toEqual([]);
    expect(disk.get(PATHS.configFile)).toBe(text);
    expect(writes()).toEqual([]);
  });
});

describe("settings.json", () => {
  it("reports a file without a marker as invalid and leaves it alone", async () => {
    const text = put(PATHS.settingsFile, { theme: "dark" });
    expect((await initializeSettings()).status).toBe("invalid");
    expect(disk.get(PATHS.settingsFile)).toBe(text);
    expect(writes()).toEqual([]);
  });

  it("refuses a newer build's file and leaves it byte-identical", async () => {
    const text = put(PATHS.settingsFile, { formatVersion: 2, theme: { mode: "dusk" } });
    expect(await initializeSettings()).toEqual({ status: "newer", formatVersion: 2, filePath: PATHS.settingsFile });
    await expect(flushSettings(PATHS.settingsFile, () => {
      throw new Error("never asked for");
    })).rejects.toThrow();
    expect(disk.get(PATHS.settingsFile)).toBe(text);
    expect(writes()).toEqual([]);
  });
});

describe("workspace documents", () => {
  const path = "/docs/workspace.json";

  it("reports a document without a marker as invalid and leaves it alone", async () => {
    const text = put(path, { id: "w", name: "Work", openTabs: [], recentFiles: [] });
    expect((await loadWorkspace(path)).status).toBe("invalid");
    expect(disk.get(path)).toBe(text);
    expect(writes()).toEqual([]);
  });

  it("round-trips the current version", async () => {
    const text = put(path, { formatVersion: 1, id: "w", name: "Work", openTabs: [], recentFiles: [] });
    const result = await loadWorkspace(path);
    expect(result).toMatchObject({ status: "success", workspace: { id: "w" } });
    if (result.status !== "success") return;
    await flushWorkspace(path, () => result.workspace);
    expect(JSON.parse(disk.get(path)!)).toEqual(JSON.parse(text));
  });

  it("refuses a newer build's document and leaves it byte-identical, even without an id", async () => {
    const text = put(path, { formatVersion: 2, name: "Work", openTabs: {} });
    expect(await loadWorkspace(path)).toEqual({ status: "newer", formatVersion: 2 });
    expect(disk.get(path)).toBe(text);
    expect(writes()).toEqual([]);
  });
});

describe("task lists", () => {
  it("reports a list without a marker as invalid and leaves it alone", async () => {
    const path = "/repo/legacy.json";
    const text = put(path, { id: "L1", tasks: [] });
    expect((await loadTaskList(path, (read) => read())).status).toBe("invalid");
    expect(disk.get(path)).toBe(text);
    expect(writes()).toEqual([]);
  });

  it("round-trips the current version", async () => {
    const path = "/repo/current.json";
    put(path, { formatVersion: 1, id: "L1", tasks: [] });
    const loaded = await loadTaskList(path, (read) => read());
    expect(loaded).toMatchObject({ status: "success", taskList: { data: { id: "L1" } } });
    if (loaded.status !== "success") return;
    expect(await flushTaskList(path, () => loaded.taskList.data)).toEqual({ status: "success" });
    expect(stored(path)).toEqual({ formatVersion: 1, id: "L1", tasks: [] });
  });

  it("refuses a newer build's list and leaves it byte-identical, even without an id", async () => {
    const path = "/repo/newer.json";
    const text = put(path, { formatVersion: 2, items: [] });
    expect(await loadTaskList(path, (read) => read())).toEqual({ status: "newer", formatVersion: 2 });
    expect(disk.get(path)).toBe(text);
    expect(writes()).toEqual([]);
  });
});

// A `version` label is not a marker: a document carrying one instead is
// refused like any other unreadable file.
describe("a version label instead of a marker", () => {
  it("sets aside its state.json and starts on the defaults", async () => {
    const text = put(PATHS.stateFile, { version: "1.0.0", lastWorkspacePath: "/docs/workspace.json" });
    const { appState } = await initializeAppState();
    expect(appState.lastWorkspacePath).toBe("");
    expect(disk.get(`${PATHS.stateFile}.invalid`)).toBe(text);
  });

  it("refuses a workspace and leaves it alone", async () => {
    const path = "/docs/workspace.json";
    const text = put(path, { version: "1.0.0", id: "w", name: "Work", openTabs: [], recentFiles: [] });
    expect((await loadWorkspace(path)).status).toBe("invalid");
    expect(disk.get(path)).toBe(text);
    expect(writes()).toEqual([]);
  });
});

describe("one app-wide settings collection", () => {
  it("uses built-ins on first launch without creating settings or user documents", async () => {
    expect(await initializeSettings()).toEqual({ status: "success", settings: createDefaultSettings(), filePath: PATHS.settingsFile });
    expect([...disk.keys()]).toEqual([]);
  });

  it("saves only changed sets, reloads them and removes overrides on reset", async () => {
    const initial = await initializeSettings();
    if (initial.status !== "success") throw new Error("initialization failed");
    await flushSettings(initial.filePath, () => ({ ...initial.settings, theme: "dark", kickDistances: [3, 15] }));
    expect(stored(PATHS.settingsFile)).toEqual({ formatVersion: 1, theme: "dark", kickDistances: [3, 15] });
    expect(await initializeSettings()).toMatchObject({ status: "success", settings: { theme: "dark", kickDistances: [3, 15] } });
    await flushSettings(initial.filePath, createDefaultSettings);
    expect(stored(PATHS.settingsFile)).toEqual({ formatVersion: 1 });
    expect((await initializeSettings())).toMatchObject({ status: "success", settings: { theme: "system" } });
  });

  it("keeps an empty kick-distances list as the user's choice across a reload", async () => {
    const initial = await initializeSettings();
    if (initial.status !== "success") throw new Error("initialization failed");
    await flushSettings(initial.filePath, () => ({ ...initial.settings, kickDistances: [] }));
    expect(stored(PATHS.settingsFile)).toEqual({ formatVersion: 1, kickDistances: [] });
    expect(await initializeSettings()).toMatchObject({ status: "success", settings: { kickDistances: [] } });
  });

  it.each([
    "{bad", JSON.stringify({ formatVersion: 2, theme: "future" }),
    JSON.stringify({ formatVersion: 1, unknownSetting: "authored value" }),
  ])("protects unavailable settings without falling back to built-ins", async (contents) => {
    disk.set(PATHS.settingsFile, contents);
    expect((await initializeSettings()).status).not.toBe("success");
    await expect(flushSettings(PATHS.settingsFile, createDefaultSettings)).rejects.toThrow();
    expect(disk.get(PATHS.settingsFile)).toBe(contents);
    expect(writes()).toEqual([]);
  });
});
