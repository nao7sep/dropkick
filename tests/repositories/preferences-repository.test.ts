import { describe, it, expect, beforeEach, vi } from "vitest";

const readJsonFileResult = vi.fn();
const writeJsonFile = vi.fn();
const warn = vi.fn();
vi.mock("../../src/repositories/file-system", () => ({
  readJsonFileResult: (p: string) => readJsonFileResult(p),
  writeJsonFile: (p: string, _format: string, d: unknown) => writeJsonFile(p, d),
  withSerial: (_p: string, fn: () => unknown) => fn(),
}));
vi.mock("../../src/repositories/logging", () => ({ log: { warn: (...args: unknown[]) => warn(...args) } }));
import { createDefaultPreferences } from "../../src/models";

type PreferencesRepository = typeof import("../../src/repositories/preferences-repository");
let loadLegacyPreferences: PreferencesRepository["loadLegacyPreferences"];


beforeEach(async () => {
  vi.resetModules();
  ({ loadLegacyPreferences } = await import("../../src/repositories/preferences-repository"));
  readJsonFileResult.mockReset();
  writeJsonFile.mockReset();
  warn.mockReset();
});
const stored = (data: unknown) => readJsonFileResult.mockResolvedValue({ status: "success", data });

describe("preferences sets", () => {
  it("loads identity plus one set without writing or seeding the others", async () => {
    stored({ id: "prefs", name: "Work", theme: "dark" });
    const result = await loadLegacyPreferences("/prefs.json");
    expect(result).toEqual({ status: "success", preferences: {
      ...createDefaultPreferences(), theme: "dark",
    } });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("preserves identity without materializing or rewriting an empty id", async () => {
    stored({ id: "", name: "Empty" });
    const result = await loadLegacyPreferences("/prefs.json");
    expect(result.status === "success" && "id" in result.preferences).toBe(false);
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("ignores version, unknown keys, and the retired darkMode choice", async () => {
    stored({ id: "prefs", version: "999", name: "Work", darkMode: true, unknown: 42 });
    const result = await loadLegacyPreferences("/prefs.json");
    expect(result.status === "success" && result.preferences.theme).toBe("system");
    expect(result.status === "success" && "version" in result.preferences).toBe(false);
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it.each([
    ["language", "xx", "system"], ["theme", "sepia", "system"],
    ["fontFamily", 42, ""], ["fontFamily", " Inter ", ""], ["timezone", 3, "system"], ["timezone", "Not/AZone", "system"],
    ["kickDistances", "nope", [5, 25]], ["kickDistances", [5, "25"], [5, 25]], ["kickDistances", [5, 5, 1000], [5, 25]],
    ["dueSoonDays", "abc", 7], ["dueSoonDays", 100000000, 7], ["handledTasksPageSize", null, 50], ["handledTasksPageSize", -5, 50],
    ["confirmPermanentDeletions", "no", true],
  ])("reads an invalid %s set (%j) as its built-in and warns", async (key, value, fallback) => {
    stored({ id: "prefs", name: "Work", [key as string]: value, theme: key === "theme" ? value : "dark" });
    const result = await loadLegacyPreferences("/prefs.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.preferences[key as keyof typeof result.preferences]).toEqual(fallback);
    expect(result.preferences.theme).toBe(key === "theme" ? "system" : "dark");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toEqual({ path: "/prefs.json", key });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("warns on every load of an invalid set", async () => {
    stored({ id: "prefs", name: "Work", theme: "sepia" });
    await loadLegacyPreferences("/prefs.json");
    await loadLegacyPreferences("/prefs.json");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("reads an absent time zone as the system token without a warning", async () => {
    stored({ id: "prefs", name: "Work" });
    const result = await loadLegacyPreferences("/prefs.json");
    expect(result.status === "success" && result.preferences.timezone).toBe("system");
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads a null time zone as an invalid set: its built-in, with a warning", async () => {
    stored({ id: "prefs", name: "Work", timezone: null });
    const result = await loadLegacyPreferences("/prefs.json");
    expect(result.status === "success" && result.preferences.timezone).toBe("system");
    expect(warn).toHaveBeenCalledExactlyOnceWith("preferences set is invalid; using built-in", { path: "/prefs.json", key: "timezone" });
  });

  it.each([null, [], "preferences", 7, { name: "foreign", version: "1" }, { id: "prefs" }])("rejects a document without identity and name (%j) without rewriting", async (data) => {
    stored(data);
    expect(await loadLegacyPreferences("/foreign.json")).toEqual({ status: "invalid", message: "not a preferences document" });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it.each([
    ["a workspace", { version: "1.0.0", id: "ws", name: "WS", openTabs: [], recentFiles: [] }],
    ["a task list", { version: "1.0.0", id: "list", tasks: [] }],
  ])("rejects %s, which carries its own identity, without rewriting it", async (_kind, data) => {
    stored(data);
    expect(await loadLegacyPreferences("/foreign.json")).toEqual({ status: "invalid", message: "not a preferences document" });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it.each([
    { status: "missing" }, { status: "invalid", message: "bad JSON" }, { status: "error", message: "EACCES" },
  ])("propagates an unsuccessful read without writing", async (result) => {
    readJsonFileResult.mockResolvedValue(result);
    expect(await loadLegacyPreferences("/prefs.json")).toEqual(result);
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

});
