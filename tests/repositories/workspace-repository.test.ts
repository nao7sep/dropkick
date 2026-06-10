import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the file-system layer so we control exactly what the stored file
// contains. createDefaultWorkspace (and its real nanoid-based id) runs for real.
const readJsonFileResult = vi.fn();
const writeJsonFile = vi.fn();

vi.mock("../../src/repositories/file-system", () => ({
  readJsonFileResult: (p: string) => readJsonFileResult(p),
  writeJsonFile: (p: string, d: unknown) => writeJsonFile(p, d),
  withSerial: (_p: string, fn: () => unknown) => fn(),
}));

import { loadWorkspace } from "../../src/repositories/workspace-repository";

beforeEach(() => {
  readJsonFileResult.mockReset();
  writeJsonFile.mockReset();
});

describe("loadWorkspace — merge with defaults", () => {
  it("fills newly added fields from defaults while preserving stored ones", async () => {
    // A workspace file written before `id` existed.
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: {
        version: "1.0.0",
        name: "Legacy",
        openTabs: [
          { filePath: "/a.json", displayName: "A", isUnifiedView: false },
        ],
        recentFiles: [],
      },
    });

    const result = await loadWorkspace("/ws.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(typeof result.workspace.id).toBe("string");
    expect(result.workspace.id.length).toBeGreaterThan(0);
    expect(result.workspace.name).toBe("Legacy");
    expect(result.workspace.openTabs).toHaveLength(1);
  });

  it("re-injects the runtime-only activeTabIndex from defaults, ignoring any stored value", async () => {
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "Stale", activeTabIndex: 7 },
    });

    const result = await loadWorkspace("/ws.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.workspace.activeTabIndex).toBe(-1);
  });

  it("drops stored keys that are no longer part of the shape", async () => {
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "Legacy", retiredField: "stale" },
    });

    const result = await loadWorkspace("/ws.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect("retiredField" in result.workspace).toBe(false);
  });

  it("coerces a non-array openTabs/recentFiles to an empty list so a corrupted file cannot crash startup", async () => {
    // A hand-edited or partially-corrupted file holds non-array values where the
    // startup path expects to call .findIndex / .length.
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "Corrupt", openTabs: "nope", recentFiles: 5 },
    });

    const result = await loadWorkspace("/ws.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.workspace.openTabs).toEqual([]);
    expect(result.workspace.recentFiles).toEqual([]);
  });

  it("coerces a null openTabs/recentFiles to an empty list", async () => {
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "Nulls", openTabs: null, recentFiles: null },
    });

    const result = await loadWorkspace("/ws.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.workspace.openTabs).toEqual([]);
    expect(result.workspace.recentFiles).toEqual([]);
  });

  it("propagates a missing file as missing", async () => {
    readJsonFileResult.mockResolvedValue({ status: "missing" });
    const result = await loadWorkspace("/ws.json");
    expect(result.status).toBe("missing");
  });

  it("propagates an invalid file result unchanged", async () => {
    readJsonFileResult.mockResolvedValue({ status: "invalid", message: "bad json" });
    const result = await loadWorkspace("/ws.json");
    expect(result).toEqual({ status: "invalid", message: "bad json" });
  });
});
