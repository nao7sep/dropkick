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

import { loadPreferences } from "../../src/repositories/preferences-repository";

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
