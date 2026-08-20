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
      data: {
        version: "1.0.0",
        name: "Stale",
        openTabs: [],
        recentFiles: [],
        activeTabIndex: 7,
      },
    });

    const result = await loadWorkspace("/ws.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.workspace.activeTabIndex).toBe(-1);
  });

  it("drops stored keys that are no longer part of the shape", async () => {
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: {
        version: "1.0.0",
        name: "Legacy",
        openTabs: [],
        recentFiles: [],
        retiredField: "stale",
      },
    });

    const result = await loadWorkspace("/ws.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect("retiredField" in result.workspace).toBe(false);
  });

  it("reports a present-but-wrong-shape openTabs/recentFiles as invalid instead of coercing", async () => {
    // A wrong-shape field is corruption, the same branch as unparseable JSON:
    // coercing to [] and letting the next flush write the emptied lists back
    // would destroy the user's tabs on a file that never looked corrupt
    // (storage-path conventions). The failing file is reported in place; the
    // rest of the app keeps working.
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "Corrupt", openTabs: "nope", recentFiles: 5 },
    });

    expect((await loadWorkspace("/ws.json")).status).toBe("invalid");

    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "Nulls", openTabs: null, recentFiles: null },
    });
    expect((await loadWorkspace("/ws.json")).status).toBe("invalid");
  });

  it("rejects a JSON document that is not a workspace, without rewriting it", async () => {
    // The startup picker hands loadWorkspace whatever the user chose in a
    // *.json file dialog. Merging fills every field from defaults, so without a
    // kind gate a mis-picked package.json loads as an empty workspace and the
    // id write-back replaces its contents. Absent discriminator fields are as
    // disqualifying as wrong-typed ones — a real workspace always carries them.
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { name: "dropkick", version: "0.1.0", scripts: { dev: "vite" } },
    });

    expect((await loadWorkspace("/package.json")).status).toBe("invalid");
    expect(writeJsonFile).not.toHaveBeenCalled();

    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "Sparse" },
    });
    expect((await loadWorkspace("/ws.json")).status).toBe("invalid");
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("fills an absent openTabs/recentFiles from the defaults", async () => {
    // Recognizing the document kind is a separate question from field shape: a
    // workspace that carries one of the two lists still heals the other.
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", id: "w1", name: "Sparse", recentFiles: [] },
    });

    const result = await loadWorkspace("/ws.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.workspace.openTabs).toEqual([]);
    expect(result.workspace.recentFiles).toEqual([]);
  });

  it("mints a stable id when the stored one is an empty string", async () => {
    // mergeWithDefaults deliberately preserves "", so taking the merged value
    // would re-detect and re-persist the empty id on every launch and the
    // document would never gain the identity it is supposed to keep.
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: {
        version: "1.0.0",
        id: "",
        name: "Empty id",
        openTabs: [],
        recentFiles: [],
      },
    });

    const result = await loadWorkspace("/ws.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.workspace.id.length).toBeGreaterThan(0);
    expect(writeJsonFile).toHaveBeenCalledWith(
      "/ws.json",
      expect.objectContaining({ id: result.workspace.id }),
    );
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
