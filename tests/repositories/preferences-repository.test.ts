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
import { createDefaultPreferences } from "../../src/models";

type PreferencesRepository = typeof import("../../src/repositories/preferences-repository");
let loadPreferences: PreferencesRepository["loadPreferences"];
let flushPreferences: PreferencesRepository["flushPreferences"];
let createPreferencesFile: PreferencesRepository["createPreferencesFile"];

beforeEach(async () => {
  vi.resetModules();
  ({ loadPreferences, flushPreferences, createPreferencesFile } = await import("../../src/repositories/preferences-repository"));
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
    ["fontFamily", 42, ""], ["fontFamily", " Inter ", ""], ["timezone", 3, "system"], ["timezone", "Not/AZone", "system"],
    ["kickDistances", "nope", [5, 25]], ["kickDistances", [5, "25"], [5, 25]], ["kickDistances", [5, 5, 1000], [5, 25]],
    ["dueSoonDays", "abc", 7], ["dueSoonDays", 100000000, 7], ["handledTasksPageSize", null, 50], ["handledTasksPageSize", -5, 50],
    ["confirmPermanentDeletions", "no", true],
  ])("reads an invalid %s set (%j) as its built-in and warns", async (key, value, fallback) => {
    stored({ id: "prefs", name: "Work", [key as string]: value, theme: key === "theme" ? value : "dark" });
    const result = await loadPreferences("/prefs.json");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.preferences[key as keyof typeof result.preferences]).toEqual(fallback);
    expect(result.preferences.theme).toBe(key === "theme" ? "system" : "dark");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toEqual({ path: "/prefs.json", key });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("warns on every load of an invalid set", async () => {
    stored({ id: "prefs", theme: "sepia" });
    await loadPreferences("/prefs.json");
    await loadPreferences("/prefs.json");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ id: "prefs" }], [{ id: "prefs", timezone: null }],
  ])("reads the time zone of %j as the system token without a warning", async (data) => {
    stored(data);
    const result = await loadPreferences("/prefs.json");
    expect(result.status === "success" && result.preferences.timezone).toBe("system");
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([null, [], "preferences", 7, { name: "foreign", version: "1" }])("rejects a document without identity (%j) without rewriting", async (data) => {
    stored(data);
    expect(await loadPreferences("/foreign.json")).toEqual({ status: "invalid", message: "not a preferences document" });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it.each([
    ["a workspace", { version: "1.0.0", id: "ws", name: "WS", openTabs: [], recentFiles: [] }],
    ["a task list", { version: "1.0.0", id: "list", tasks: [] }],
  ])("rejects %s, which carries its own identity, without rewriting it", async (_kind, data) => {
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

  it("writes identity and every set that differs from its built-in, from memory", async () => {
    stored({ id: "prefs", name: "Work", version: "1.0.0", darkMode: true, fontFamily: "On disk" });
    const preferences = { ...createDefaultPreferences("Work"), id: "prefs", theme: "dark" as const, dueSoonDays: 3 };
    await flushPreferences("/prefs.json", () => preferences);
    expect(writeJsonFile).toHaveBeenCalledWith("/prefs.json", { id: "prefs", name: "Work", theme: "dark", dueSoonDays: 3 });
  });

  it("drops the key of a set saved equal to its built-in", async () => {
    stored({ id: "prefs", name: "Work", theme: "dark", timezone: "Asia/Tokyo" });
    await flushPreferences("/prefs.json", () => ({ ...createDefaultPreferences("Work"), id: "prefs" }));
    expect(writeJsonFile).toHaveBeenCalledWith("/prefs.json", { id: "prefs", name: "Work" });
  });

  it("heals an invalid set at the next save", async () => {
    stored({ id: "prefs", name: "Work", timezone: "Not/AZone", kickDistances: [5, 5] });
    const loaded = await loadPreferences("/prefs.json");
    if (loaded.status !== "success") throw new Error("load failed");
    await flushPreferences("/prefs.json", () => ({ ...loaded.preferences, theme: "dark" }));
    expect(writeJsonFile).toHaveBeenCalledWith("/prefs.json", { id: "prefs", name: "Work", theme: "dark" });
  });

  it("refuses to write an invalid set", async () => {
    stored({ id: "prefs", name: "Work" });
    const preferences = { ...createDefaultPreferences("Work"), timezone: "Not/AZone" };
    await expect(flushPreferences("/prefs.json", () => preferences)).rejects.toThrow("timezone");
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("never writes over a document of another kind on save", async () => {
    stored({ version: "1.0.0", id: "prefs", name: "Work", openTabs: [], recentFiles: [] });
    const preferences = { ...createDefaultPreferences("Work"), id: "prefs", theme: "dark" as const };
    await expect(flushPreferences("/prefs.json", () => preferences)).rejects.toThrow();
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("recreates a preferences file that has disappeared", async () => {
    readJsonFileResult.mockResolvedValue({ status: "missing" });
    const preferences = { ...createDefaultPreferences("Work"), id: "prefs", theme: "dark" as const };
    await flushPreferences("/prefs.json", () => preferences);
    expect(writeJsonFile).toHaveBeenCalledWith("/prefs.json", { id: "prefs", name: "Work", theme: "dark" });
  });

  it.each([
    { status: "invalid", message: "bad JSON" }, { status: "error", message: "EACCES" },
  ])("does not overwrite a file it cannot read (%j) on save", async (result) => {
    readJsonFileResult.mockResolvedValue(result);
    await expect(flushPreferences("/prefs.json", () => createDefaultPreferences("Work"))).rejects.toThrow();
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("does not overwrite an unreadable or foreign document on save", async () => {
    stored({ name: "foreign" });
    await expect(flushPreferences("/prefs.json", () => createDefaultPreferences("Work"))).rejects.toThrow();
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
});
