import { describe, it, expect, beforeEach, vi } from "vitest";

const readJsonFileResult = vi.fn();
const writeJsonFile = vi.fn();
const warn = vi.fn();
vi.mock("../../src/repositories/file-system", () => ({
  readJsonFileResult: (p: string) => readJsonFileResult(p),
  writeJsonFile: (p: string, d: unknown) => writeJsonFile(p, d),
  withSerial: (_p: string, fn: () => unknown) => fn(),
}));
vi.mock("../../src/repositories/logging", () => ({ log: { warn: (...args: unknown[]) => warn(...args) } }));
import { loadPreferences, flushPreferences, createPreferencesFile } from "../../src/repositories/preferences-repository";
import { createDefaultPreferences } from "../../src/models";

beforeEach(() => {
  readJsonFileResult.mockReset();
  writeJsonFile.mockReset();
  warn.mockReset();
});
const stored = (data: unknown) => readJsonFileResult.mockResolvedValue({ status: "success", data });

describe("preferences sets", () => {
  it("creates only document identity, with effective built-ins in memory", async () => {
    const preferences = await createPreferencesFile("/prefs.json", "Default");
    expect(writeJsonFile).toHaveBeenCalledWith("/prefs.json", { id: preferences.id, name: "Default" });
    expect(preferences.theme).toBe("system");
  });

  it("loads identity plus one set without writing or seeding the others", async () => {
    stored({ id: "prefs", name: "Work", theme: "dark" });
    const result = await loadPreferences("/prefs.json");
    expect(result).toEqual({ status: "success", preferences: {
      ...createDefaultPreferences("Work"), id: "prefs", theme: "dark",
    } });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("preserves identity without materializing or rewriting an empty id", async () => {
    stored({ id: "", name: "Empty" });
    const result = await loadPreferences("/prefs.json");
    expect(result.status === "success" && result.preferences.id).toBe("");
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("ignores version, unknown keys, and the retired darkMode choice", async () => {
    stored({ id: "prefs", version: "999", name: "Work", darkMode: true, unknown: 42 });
    const result = await loadPreferences("/prefs.json");
    expect(result.status === "success" && result.preferences.theme).toBe("system");
    expect(result.status === "success" && "version" in result.preferences).toBe(false);
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it.each([
    ["language", "xx", "system"], ["theme", "sepia", "system"],
    ["fontFamily", 42, ""], ["timezone", 3, null],
    ["kickDistances", "nope", [5, 25]], ["kickDistances", [5, "25"], [5, 25]],
    ["dueSoonDays", "abc", 7], ["handledTasksPageSize", null, 50],
    ["confirmPermanentDeletions", "no", true],
  ])("uses the built-in for a wrong-shaped %s set and warns once", async (key, value, fallback) => {
    stored({ id: "prefs", name: "Work", [key as string]: value, theme: key === "theme" ? value : "dark" });
    const result = await loadPreferences("/prefs.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.preferences[key as keyof typeof result.preferences]).toEqual(fallback);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toEqual({ path: "/prefs.json", key });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("retains existing range normalization after reading a correctly shaped set", async () => {
    stored({ id: "prefs", kickDistances: [5, 5, 1000, 0, -3], dueSoonDays: 100000000, handledTasksPageSize: -5 });
    const result = await loadPreferences("/prefs.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.preferences.kickDistances).toEqual([5, 999]);
    expect(result.preferences.dueSoonDays).toBe(365);
    expect(result.preferences.handledTasksPageSize).toBe(10);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([null, [], "preferences", 7, { name: "foreign", version: "1" }])("rejects a document without identity (%j) without rewriting", async (data) => {
    stored(data);
    expect(await loadPreferences("/foreign.json")).toEqual({ status: "invalid", message: "not a preferences document" });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it.each([
    { status: "missing" }, { status: "invalid", message: "bad JSON" }, { status: "error", message: "EACCES" },
  ])("propagates an unsuccessful read without writing", async (result) => {
    readJsonFileResult.mockResolvedValue(result);
    expect(await loadPreferences("/prefs.json")).toEqual(result);
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("changing one set writes exactly that set beside identity and drops a version key", async () => {
    stored({ id: "prefs", name: "Work", version: "1.0.0", darkMode: true });
    const preferences = { ...createDefaultPreferences("Work"), id: "prefs", theme: "dark" as const };
    await flushPreferences("/prefs.json", () => preferences, ["theme"]);
    expect(writeJsonFile).toHaveBeenCalledWith("/prefs.json", { id: "prefs", name: "Work", theme: "dark" });
  });

  it("re-reads the disk map and keeps unchanged sets exactly as stored", async () => {
    stored({ id: "prefs", name: "Work", kickDistances: [2000, 5, 5], fontFamily: "External edit" });
    const preferences = { ...createDefaultPreferences("Work"), theme: "dark" as const };
    const saved = await flushPreferences("/prefs.json", () => preferences, ["theme"]);
    expect(writeJsonFile).toHaveBeenCalledWith("/prefs.json", {
      id: "prefs", name: "Work", kickDistances: [2000, 5, 5], fontFamily: "External edit", theme: "dark",
    });
    expect(saved.fontFamily).toBe("External edit");
  });

  it("normalizes only the whole changed set before writing", async () => {
    stored({ id: "prefs", name: "Work" });
    const preferences = { ...createDefaultPreferences("Work"), kickDistances: [10, 10, 2000] };
    const saved = await flushPreferences("/prefs.json", () => preferences, ["kickDistances"]);
    expect(saved.kickDistances).toEqual([10, 999]);
    expect(writeJsonFile).toHaveBeenCalledWith("/prefs.json", { id: "prefs", name: "Work", kickDistances: [10, 999] });
  });

  it("does not overwrite an unreadable or foreign document on save", async () => {
    stored({ name: "foreign" });
    await expect(flushPreferences("/prefs.json", () => createDefaultPreferences("Work"), ["theme"])).rejects.toThrow();
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
});
