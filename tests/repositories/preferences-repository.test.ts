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

describe("loadPreferences — drops keys removed from the shape", () => {
  it("does not carry through stored fields that are no longer part of PreferencesDto", async () => {
    // A file written by an older version still carries the retired date/time
    // format settings (plus a hypothetical unknown key). None must survive the
    // load, otherwise the next flush re-emits them on disk forever.
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: {
        version: "1.0.0",
        name: "Legacy",
        darkMode: true,
        dateFormat: "YYYY-MM-DD",
        timeFormat: "24h",
        somethingUnknown: 42,
      },
    });

    const result = await loadPreferences("/prefs.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    const prefs = result.preferences as unknown as Record<string, unknown>;
    expect("dateFormat" in prefs).toBe(false);
    expect("timeFormat" in prefs).toBe(false);
    expect("somethingUnknown" in prefs).toBe(false);
    // Known fields still load correctly through the projection.
    expect(result.preferences.name).toBe("Legacy");
    expect(result.preferences.darkMode).toBe(true);
  });

  it("heals a null-corrupted scalar field to its default", async () => {
    // A hand-edited file stores null where a non-null default is expected; the
    // load boundary must fall back to the default rather than carry null into
    // the DTO.
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "Nulls", darkMode: null, dueSoonDays: null },
    });

    const result = await loadPreferences("/prefs.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.preferences.darkMode).toBe(false);
    expect(result.preferences.dueSoonDays).toBe(7);
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

  it("reports a present-but-non-array kickDistances as invalid instead of coercing it", async () => {
    // A wrong-shape field is corruption, the same branch as unparseable JSON:
    // coercing it and letting the next flush write defaults back would destroy
    // the user's file quietly (storage-path conventions).
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "Broken", kickDistances: "nope" },
    });

    const result = await loadPreferences("/prefs.json");
    expect(result.status).toBe("invalid");
  });

  it("fills an absent kickDistances from the defaults", async () => {
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "NoKicks", darkMode: false },
    });

    const result = await loadPreferences("/prefs.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.preferences.kickDistances).toEqual([5, 25]);
  });
});

describe("loadPreferences — document kind", () => {
  it("rejects a JSON document that is not a preferences file, without rewriting it", async () => {
    // The startup picker hands loadPreferences whatever the user chose in a
    // *.json file dialog. Merging fills every field from defaults, so without a
    // kind gate a mis-picked package.json loads as default preferences and the
    // id write-back replaces its contents.
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { name: "dropkick", version: "0.1.0", scripts: { dev: "vite" } },
    });

    expect((await loadPreferences("/package.json")).status).toBe("invalid");
    expect(writeJsonFile).not.toHaveBeenCalled();

    // A workspace document is not a preferences document either.
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "WS", openTabs: [], recentFiles: [] },
    });
    expect((await loadPreferences("/ws.json")).status).toBe("invalid");
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it.each([null, [], "preferences", 7])(
    "rejects a non-object JSON root (%j) instead of throwing",
    async (data) => {
      readJsonFileResult.mockResolvedValue({ status: "success", data });

      await expect(loadPreferences("/not-an-object.json")).resolves.toEqual({
        status: "invalid",
        message: "not a preferences document",
      });
      expect(writeJsonFile).not.toHaveBeenCalled();
    },
  );

  it("mints a stable id when the stored one is an empty string", async () => {
    // mergeWithDefaults deliberately preserves "", so taking the merged value
    // would re-detect and re-persist the empty id on every launch and the
    // document would never gain the identity it is supposed to keep.
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", id: "", name: "Empty id", darkMode: false },
    });

    const result = await loadPreferences("/prefs.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.preferences.id.length).toBeGreaterThan(0);
    expect(writeJsonFile).toHaveBeenCalledWith(
      "/prefs.json",
      expect.objectContaining({ id: result.preferences.id }),
    );
  });
});

describe("loadPreferences — numeric range normalization", () => {
  it("clamps an out-of-range dueSoonDays instead of feeding it to date math", async () => {
    // dueSoonDays reaches addDays; an unbounded value overflows the Date range
    // and throws inside a render, where the caller cannot recover.
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "Huge", dueSoonDays: 100000000 },
    });

    const result = await loadPreferences("/prefs.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.preferences.dueSoonDays).toBe(365);
  });

  it("falls back to the default for a non-numeric dueSoonDays", async () => {
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "Stringy", dueSoonDays: "abc" },
    });

    const result = await loadPreferences("/prefs.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.preferences.dueSoonDays).toBe(7);
  });

  it("clamps a negative handledTasksPageSize, which would slice from the end", async () => {
    readJsonFileResult.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", name: "Negative", handledTasksPageSize: -5 },
    });

    const result = await loadPreferences("/prefs.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.preferences.handledTasksPageSize).toBe(10);
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
