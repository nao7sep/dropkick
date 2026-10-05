// Every store's format version (store-recovery-conventions), driven through the
// real repositories and file-system module against an in-memory disk: a file
// without a marker takes its store's unreadable branch, the current version
// round-trips, and a newer build's file is refused and left byte-identical. The Rust core's own stores and the task-list classifier are
// covered in src-tauri/tests.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { FORMAT_VERSIONS } from "../../src/models";
import { flushAppConfig, loadAppConfig } from "../../src/repositories/app-config-repository";
import { flushAppState, initializeAppState } from "../../src/repositories/app-state-repository";
import { flushNoteDrafts, loadNoteDrafts } from "../../src/repositories/note-draft-repository";
import { flushPreferences, loadPreferences } from "../../src/repositories/preferences-repository";
import { flushTaskList, loadTaskList } from "../../src/repositories/task-list-repository";
import { flushWorkspace, loadWorkspace } from "../../src/repositories/workspace-repository";

const ROOT = "/home/u/.dropkick";
const PATHS = {
  root: ROOT,
  stateFile: `${ROOT}/state.json`,
  configFile: `${ROOT}/config.json`,
  preferencesFile: `${ROOT}/preferences.json`,
  workspaceFile: `${ROOT}/workspace.json`,
  noteDraftsFile: `${ROOT}/note-drafts.json`,
  logsDir: `${ROOT}/logs`,
  backupsFile: `${ROOT}/backups.sqlite3`,
  recordsFile: `${ROOT}/records.sqlite3`,
};

const disk = new Map<string, string>();

// The task-list read is the core's; this stand-in answers as its classifier
// does for the documents used here (src-tauri/tests/atomic_write.rs owns it).
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
      case "hash_file":
        return disk.get(path) ?? null;
      case "file_exists":
        return disk.has(path);
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
    command === "write_text_file_atomic" || command === "quarantine_file");
}

function writesTo(path: string): unknown[] {
  return writes().filter((call) => (call as [string, { path: string }])[1].path === path);
}

describe("state.json", () => {
  it("sets aside a file without a marker and starts on the defaults", async () => {
    const text = put(PATHS.stateFile, { version: "1.0.0", zoomLevel: 1.5 });
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
    const text = put(PATHS.stateFile, { formatVersion: 2, zoomLevel: "large" });
    const { appState, statePath } = await initializeAppState();
    expect(statePath).toBe("");
    expect(appState.zoomLevel).toBe(1);
    expect(disk.get(PATHS.stateFile)).toBe(text);
    expect(writesTo(PATHS.stateFile)).toEqual([]);
  });
});

describe("config.json", () => {
  it("quarantines a file without a marker and uses the built-ins", async () => {
    const text = put(PATHS.configFile, { knownWorkspaces: ["/w.json"] });
    const { appConfig, recovery } = await loadAppConfig();
    expect(recovery).toEqual({ kind: "quarantined", quarantinedTo: `${PATHS.configFile}.invalid` });
    expect(appConfig.knownWorkspaces).toEqual([PATHS.workspaceFile]);
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
    const text = put(PATHS.configFile, { formatVersion: 2, knownWorkspaces: { "/w.json": {} } });
    const { appConfig, filePath, recovery } = await loadAppConfig();
    expect(recovery).toEqual({ kind: "newer", formatVersion: 2 });
    expect(filePath).toBe("");
    expect(appConfig.knownWorkspaces).toEqual([PATHS.workspaceFile]);
    expect(disk.get(PATHS.configFile)).toBe(text);
    expect(writes()).toEqual([]);
  });
});

describe("preferences documents", () => {
  const path = "/docs/prefs.json";

  it("reports a document without a marker as invalid and leaves it alone", async () => {
    const text = put(path, { version: "1.0.0", id: "p", name: "Work", theme: "dark" });
    expect((await loadPreferences(path)).status).toBe("invalid");
    expect(disk.get(path)).toBe(text);
    expect(writes()).toEqual([]);
  });

  it("round-trips the current version", async () => {
    put(path, { formatVersion: 1, id: "p", name: "Work", theme: "dark" });
    const result = await loadPreferences(path);
    expect(result).toMatchObject({ status: "success", preferences: { id: "p", theme: "dark" } });
    if (result.status !== "success") return;
    await flushPreferences(path, () => result.preferences);
    expect(stored(path)).toEqual({ formatVersion: 1, id: "p", name: "Work", theme: "dark" });
  });

  it("refuses a newer build's document and leaves it byte-identical", async () => {
    const text = put(path, { formatVersion: 2, id: "p", name: "Work", theme: { mode: "dusk" } });
    expect(await loadPreferences(path)).toEqual({ status: "newer", formatVersion: 2 });
    await expect(flushPreferences(path, () => {
      throw new Error("never asked for");
    })).rejects.toThrow();
    expect(disk.get(path)).toBe(text);
    expect(writes()).toEqual([]);
  });
});

describe("workspace documents", () => {
  const path = "/docs/workspace.json";

  it("reports a document without a marker as invalid and leaves it alone", async () => {
    const text = put(path, { version: "1.0.0", id: "w", name: "Work", openTabs: [], recentFiles: [] });
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

describe("note-drafts.json", () => {
  it("quarantines a file without a marker and starts empty", async () => {
    const text = put(PATHS.noteDraftsFile, { version: "1.0.0", drafts: { t1: "typed" } });
    expect(await loadNoteDrafts()).toEqual({
      drafts: {},
      filePath: PATHS.noteDraftsFile,
      recovery: { kind: "quarantined", quarantinedTo: `${PATHS.noteDraftsFile}.invalid` },
    });
    expect(disk.get(`${PATHS.noteDraftsFile}.invalid`)).toBe(text);
  });

  it("round-trips the current version", async () => {
    put(PATHS.noteDraftsFile, { formatVersion: 1, drafts: { t1: "typed" } });
    const loaded = await loadNoteDrafts();
    expect(loaded).toEqual({
      drafts: { t1: "typed" },
      filePath: PATHS.noteDraftsFile,
      recovery: null,
    });
    await flushNoteDrafts(loaded.filePath, () => loaded.drafts);
    expect(stored(PATHS.noteDraftsFile)).toEqual({ formatVersion: 1, drafts: { t1: "typed" } });
  });

  it("leaves a newer build's file byte-identical and turns persistence off", async () => {
    const text = put(PATHS.noteDraftsFile, { formatVersion: 2, drafts: [{ key: "t1" }] });
    expect(await loadNoteDrafts()).toEqual({
      drafts: {},
      filePath: "",
      recovery: { kind: "newer", formatVersion: 2 },
    });
    expect(disk.get(PATHS.noteDraftsFile)).toBe(text);
    expect(writes()).toEqual([]);
  });
});

describe("task lists", () => {
  it("reports a list without a marker as invalid and leaves it alone", async () => {
    const path = "/repo/legacy.json";
    const text = put(path, { version: "1.0.0", id: "L1", tasks: [] });
    expect((await loadTaskList(path)).status).toBe("invalid");
    expect(disk.get(path)).toBe(text);
    expect(writes()).toEqual([]);
  });

  it("round-trips the current version", async () => {
    const path = "/repo/current.json";
    put(path, { formatVersion: 1, id: "L1", tasks: [] });
    const loaded = await loadTaskList(path);
    expect(loaded).toMatchObject({ status: "success", taskList: { data: { id: "L1" } } });
    if (loaded.status !== "success") return;
    expect(await flushTaskList(path, () => loaded.taskList.data)).toEqual({ status: "success" });
    expect(stored(path)).toEqual({ formatVersion: 1, id: "L1", tasks: [] });
  });

  it("refuses a newer build's list and leaves it byte-identical, even without an id", async () => {
    const path = "/repo/newer.json";
    const text = put(path, { formatVersion: 2, items: [] });
    expect(await loadTaskList(path)).toEqual({ status: "newer", formatVersion: 2 });
    expect(disk.get(path)).toBe(text);
    expect(writes()).toEqual([]);
  });
});
