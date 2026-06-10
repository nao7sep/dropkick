import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the file-system layer so we control exactly what the stored file
// contains. The timezone utilities are left real — they are pure and the
// merge path runs them on load.
const readJsonFileResult = vi.fn();
const writeJsonFile = vi.fn();

vi.mock("../../src/repositories/file-system", () => ({
  readJsonFileResult: (p: string) => readJsonFileResult(p),
  writeJsonFile: (p: string, d: unknown) => writeJsonFile(p, d),
  withSerial: (_p: string, fn: () => unknown) => fn(),
}));

import { loadPreferences, flushPreferences } from "../../src/repositories/preferences-repository";
import { createDefaultPreferences } from "../../src/models";

beforeEach(() => {
  readJsonFileResult.mockReset();
  writeJsonFile.mockReset();
});

describe("loadPreferences — merge with defaults", () => {
  it("fills darkMode with the default (false) when absent from the stored file", async () => {
    // A preferences file written before dark mode existed: no darkMode field.
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "Legacy", dueSoonDays: 3 },
    });

    const result = await loadPreferences("/prefs.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.preferences.darkMode).toBe(false);
    // Unrelated stored fields are preserved through the merge.
    expect(result.preferences.dueSoonDays).toBe(3);
  });

  it("preserves darkMode when present in the stored file", async () => {
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "Dark", darkMode: true },
    });

    const result = await loadPreferences("/prefs.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.preferences.darkMode).toBe(true);
  });

  it("propagates a missing file as missing", async () => {
    readJsonFileResult.mockResolvedValue({ status: "missing" });
    const result = await loadPreferences("/prefs.json");
    expect(result.status).toBe("missing");
  });

  it("propagates an invalid file result unchanged", async () => {
    readJsonFileResult.mockResolvedValue({ status: "invalid", message: "bad json" });
    const result = await loadPreferences("/prefs.json");
    expect(result).toEqual({ status: "invalid", message: "bad json" });
  });
});

describe("loadPreferences — kickDistances normalization", () => {
  it("de-duplicates and clamps a malformed stored kickDistances array", async () => {
    // A hand-edited / legacy file with duplicates and an over-large value: must
    // be normalized on load so the "+N" buttons never render duplicate React
    // keys or an unclamped distance (the Settings Save path no longer repairs it).
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "Messy", kickDistances: [5, 5, 1000, 0, -3] },
    });

    const result = await loadPreferences("/prefs.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.preferences.kickDistances).toEqual([5, 999]);
  });

  it("falls back to the default pair when stored kickDistances is not a usable array", async () => {
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "Broken", kickDistances: "nope" },
    });

    const result = await loadPreferences("/prefs.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.preferences.kickDistances).toEqual([5, 25]);
  });
});

describe("flushPreferences — normalization on write", () => {
  it("normalizes a malformed in-memory kickDistances before writing", async () => {
    const bad = createDefaultPreferences("Test");
    bad.kickDistances = [10, 10, 2000];

    const normalized = await flushPreferences("/prefs.json", () => bad);

    expect(normalized.kickDistances).toEqual([10, 999]);
    expect(writeJsonFile).toHaveBeenCalledWith(
      "/prefs.json",
      expect.objectContaining({ kickDistances: [10, 999] }),
    );
  });
});
