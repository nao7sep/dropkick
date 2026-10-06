import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the file-system layer so we control exactly what the stored file
// contains. createDefaultWorkspace (and its real nanoid-based id) runs for real.
const readJsonFileResult = vi.fn();
const writeJsonFile = vi.fn();

vi.mock("../../src/repositories/file-system", () => ({
  readJsonFileResult: (p: string) => readJsonFileResult(p),
  writeJsonFile: (p: string, _format: string, d: unknown) => writeJsonFile(p, d),
  withSerial: (_p: string, fn: () => unknown) => fn(),
}));

import { loadWorkspace } from "../../src/repositories/workspace-repository";

beforeEach(() => {
  readJsonFileResult.mockReset();
  writeJsonFile.mockReset();
});

describe("loadWorkspace", () => {
  const stored = {
    id: "w1",
    name: "Work",
    openTabs: [{ filePath: "/a.json", displayName: "A", isUnifiedView: false }],
    recentFiles: [],
  };

  it("reads every stored field and sets the runtime-only activeTabIndex", async () => {
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { ...stored, activeTabIndex: 7, unknown: "left behind" },
    });

    expect(await loadWorkspace("/ws.json")).toEqual({
      status: "success",
      workspace: { ...stored, activeTabIndex: -1 },
    });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it.each(["id", "name", "openTabs", "recentFiles"])(
    "reports a document without %s as invalid and leaves it alone",
    async (field) => {
      const { [field as keyof typeof stored]: _dropped, ...rest } = stored;
      readJsonFileResult.mockResolvedValue({ status: "success", data: rest });
      expect((await loadWorkspace("/ws.json")).status).toBe("invalid");
      expect(writeJsonFile).not.toHaveBeenCalled();
    },
  );

  it("reports an empty id as invalid", async () => {
    readJsonFileResult.mockResolvedValue({ status: "success", data: { ...stored, id: "" } });
    expect((await loadWorkspace("/ws.json")).status).toBe("invalid");
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("reports a present-but-wrong-shape openTabs/recentFiles as invalid instead of coercing", async () => {
    // A wrong-shape field is corruption, the same branch as unparseable JSON:
    // coercing to [] and letting the next flush write the emptied lists back
    // would destroy the user's tabs on a file that never looked corrupt
    // (storage-path conventions). The failing file is reported in place; the
    // rest of the app keeps working.
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { id: "w1", name: "Corrupt", openTabs: "nope", recentFiles: 5 },
    });

    expect((await loadWorkspace("/ws.json")).status).toBe("invalid");

    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { id: "w1", name: "Nulls", openTabs: null, recentFiles: null },
    });
    expect((await loadWorkspace("/ws.json")).status).toBe("invalid");
  });

  it.each([
    ["a null tab", { openTabs: [null] }],
    ["a tab without its path", { openTabs: [{ displayName: "A", isUnifiedView: false }] }],
    ["a tab whose unified flag is not a boolean", { openTabs: [{ filePath: "", displayName: "U", isUnifiedView: "yes" }] }],
    ["a null recent file", { recentFiles: [null] }],
    ["a recent file without its time", { recentFiles: [{ filePath: "/a.json" }] }],
  ])("reports %s as invalid and leaves it alone", async (_label, change) => {
    readJsonFileResult.mockResolvedValue({ status: "success", data: { ...stored, ...change } });
    expect((await loadWorkspace("/ws.json")).status).toBe("invalid");
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("rejects a JSON document that is not a workspace, without rewriting it", async () => {
    // The startup picker hands loadWorkspace whatever the user chose in a
    // *.json file dialog; a mis-picked package.json must not load as a
    // workspace that a later save writes over.
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { name: "dropkick", version: "0.1.0", scripts: { dev: "vite" } },
    });

    expect((await loadWorkspace("/package.json")).status).toBe("invalid");
    expect(writeJsonFile).not.toHaveBeenCalled();

    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { id: "w1", name: "Sparse" },
    });
    expect((await loadWorkspace("/ws.json")).status).toBe("invalid");
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it.each([null, [], "workspace", 7])(
    "rejects a non-object JSON root (%j) instead of throwing",
    async (data) => {
      readJsonFileResult.mockResolvedValue({ status: "success", data });

      await expect(loadWorkspace("/not-an-object.json")).resolves.toEqual({
        status: "invalid",
        message: "not a workspace document",
      });
      expect(writeJsonFile).not.toHaveBeenCalled();
    },
  );

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
