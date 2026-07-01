import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BackupInputs } from "../../../src/services/backup/backupCollector";
import type { BackupIndex } from "../../../src/services/backup/backupTypes";

// In-memory filesystem shared by the mocked repository layer. Keys are absolute
// paths; the home root is "/home" and one external task list lives at "/proj".
interface Entry {
  content: string;
  size: number;
  mtimeMs: number;
}
let fs: Map<string, Entry>;
const callOrder: string[] = [];

function put(path: string, content: string, mtimeMs = 1000): void {
  fs.set(path, { content, size: content.length, mtimeMs });
}

vi.mock("../../../src/repositories", () => ({
  joinPath: (base: string, ...segs: string[]) => [base, ...segs].join("/"),
  withSerial: (_key: string, fn: () => unknown) => fn(),
  fileMetadata: async (path: string) => {
    const e = fs.get(path);
    if (!e) throw new Error(`missing: ${path}`);
    return { size: e.size, mtimeMs: e.mtimeMs };
  },
  listFilesRecursive: async (root: string) => {
    const prefix = root + "/";
    const out = [];
    for (const [path, e] of fs) {
      if (!path.startsWith(prefix)) continue;
      out.push({ relativePath: path.slice(prefix.length), size: e.size, mtimeMs: e.mtimeMs });
    }
    return out;
  },
  readTextFileContent: async (path: string) => {
    const e = fs.get(path);
    if (!e) throw new Error(`missing: ${path}`);
    return e.content;
  },
  readJsonFileResult: async (path: string) => {
    const e = fs.get(path);
    if (!e) return { status: "missing" };
    try {
      return { status: "success", data: JSON.parse(e.content) };
    } catch (err) {
      return { status: "invalid", message: String(err) };
    }
  },
  writeJsonFile: async (path: string, data: unknown) => {
    callOrder.push(`json:${path}`);
    put(path, JSON.stringify(data));
  },
  writeZipArchive: async (entries: [string, string][], outputPath: string) => {
    callOrder.push(`zip:${outputPath}`);
    // Record the archive's manifest so tests can assert entry paths.
    put(outputPath, JSON.stringify(entries.map(([name]) => name)));
    return outputPath;
  },
}));

// Imported after the mock is registered.
let runBackup: typeof import("../../../src/services/backup/backupEngine").runBackup;

const NOW = Date.UTC(2026, 6, 1, 8, 0, 0); // -> 20260701-080000-utc
const INDEX_PATH = "/home/backups/index.json";

function baseInputs(): BackupInputs {
  return {
    homeRoot: "/home",
    preferences: { path: "/home/preferences.json", id: "PREF" },
    workspace: { path: "/home/workspace.json", id: "WS" },
    taskListPaths: ["/proj/tasks.json"],
  };
}

function seedFiles(): void {
  put("/home/preferences.json", '{"id":"PREF"}');
  put("/home/workspace.json", '{"id":"WS"}');
  put("/home/state.json", '{"recent":[]}');
  put("/home/logs/session.log", "log line"); // excluded
  put("/proj/tasks.json", '{"id":"TL","tasks":[]}');
}

function readIndex(): BackupIndex {
  return JSON.parse(fs.get(INDEX_PATH)!.content) as BackupIndex;
}

beforeEach(async () => {
  fs = new Map();
  callOrder.length = 0;
  vi.resetModules();
  ({ runBackup } = await import("../../../src/services/backup/backupEngine"));
});

describe("runBackup", () => {
  it("first run: archives every document + home file, archive before index", async () => {
    seedFiles();
    const report = await runBackup(baseInputs(), NOW);

    expect(report.fatal).toBeNull();
    expect(report.nothingChanged).toBe(false);
    expect(report.indexWasReset).toBe(false);
    expect(report.archiveFileName).toBe("backup-20260701-080000-utc.zip");
    // preferences + workspace + task list. state.json is seeded but excluded per the
    // content-based rule (session bookkeeping, not durable work); logs/ excluded; the
    // two in-home documents are captured by id, not mirrored.
    expect(report.filesArchived).toBe(3);

    const archived = JSON.parse(fs.get("/home/backups/backup-20260701-080000-utc.zip")!.content);
    expect([...archived].sort()).toEqual([
      "preferences/PREF.json",
      "workspaces/WS/task-lists/TL.json",
      "workspaces/WS/workspace.json",
    ]);
    expect(archived).not.toContain("state.json");

    // Archive is written before the index (crash-safety invariant).
    expect(callOrder).toEqual([
      "zip:/home/backups/backup-20260701-080000-utc.zip",
      `json:${INDEX_PATH}`,
    ]);
    expect(readIndex()).toHaveLength(3);
  });

  it("second run with nothing changed writes no archive and no index", async () => {
    seedFiles();
    await runBackup(baseInputs(), NOW);
    callOrder.length = 0;

    const report = await runBackup(baseInputs(), NOW + 60_000);
    expect(report.nothingChanged).toBe(true);
    expect(report.filesArchived).toBe(0);
    expect(callOrder).toEqual([]); // nothing written
  });

  it("captures only the file whose mtime moved", async () => {
    seedFiles();
    await runBackup(baseInputs(), NOW);
    callOrder.length = 0;

    // Touch the preferences file well beyond the 2s tolerance (state.json is excluded).
    const s = fs.get("/home/preferences.json")!;
    fs.set("/home/preferences.json", { ...s, mtimeMs: s.mtimeMs + 10_000 });

    const report = await runBackup(baseInputs(), NOW + 60_000);
    expect(report.filesArchived).toBe(1);
    const archived = JSON.parse(
      fs.get("/home/backups/backup-20260701-080100-utc.zip")!.content,
    );
    expect(archived).toEqual(["preferences/PREF.json"]);
    // Index now holds the original 3 rows plus the one new capture.
    expect(readIndex()).toHaveLength(4);
  });

  it("resets a corrupt index and runs a full backup", async () => {
    seedFiles();
    put(INDEX_PATH, "{ this is not valid json");

    const report = await runBackup(baseInputs(), NOW);
    expect(report.indexWasReset).toBe(true);
    expect(report.filesArchived).toBe(3);
  });

  it("records a skip for an unreadable document but still backs up the rest", async () => {
    seedFiles();
    fs.delete("/proj/tasks.json"); // task list vanished

    const report = await runBackup(baseInputs(), NOW);
    expect(report.filesArchived).toBe(2);
    expect(report.skips.some((s) => s.sourcePath === "/proj/tasks.json")).toBe(true);
  });
});
