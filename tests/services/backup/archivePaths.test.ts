import { describe, it, expect } from "vitest";
import {
  preferencesArchivePath,
  workspaceArchivePath,
  taskListArchivePath,
  homeArchivePath,
  dedupeCaseInsensitive,
} from "../../../src/services/backup/archivePaths";
import type { BackupCandidate } from "../../../src/services/backup/backupTypes";

describe("archive path mapping", () => {
  it("keys preferences by id", () => {
    expect(preferencesArchivePath("PREF1")).toBe("preferences/PREF1.json");
  });

  it("keeps the workspace's filename inside its id directory", () => {
    expect(workspaceArchivePath("WS1", "work.json")).toBe("workspaces/WS1/work.json");
  });

  it("nests task lists under the workspace, keyed by their own id", () => {
    expect(taskListArchivePath("WS1", "TL1")).toBe("workspaces/WS1/task-lists/TL1.json");
  });

  it("mirrors a home-root file straight onto the archive root", () => {
    expect(homeArchivePath("state.json")).toBe("state.json");
  });
});

describe("dedupeCaseInsensitive", () => {
  const c = (archivePath: string, sourcePath: string): BackupCandidate => ({
    sourcePath,
    archivePath,
    sizeBytes: 1,
    mtimeMs: 0,
  });

  it("keeps everything when no two paths fold together", () => {
    const { kept, dropped } = dedupeCaseInsensitive([c("a.json", "/a"), c("b.json", "/b")]);
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });

  it("keeps the first of a case-only collision and drops the rest", () => {
    const { kept, dropped } = dedupeCaseInsensitive([
      c("State.json", "/first"),
      c("state.json", "/second"),
    ]);
    expect(kept.map((k) => k.sourcePath)).toEqual(["/first"]);
    expect(dropped.map((d) => d.sourcePath)).toEqual(["/second"]);
  });
});
