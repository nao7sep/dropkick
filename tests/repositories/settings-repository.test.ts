import { describe, it, expect, beforeEach, vi } from "vitest";

const readJsonFileResult = vi.fn();
const writeJsonFile = vi.fn();
const warn = vi.fn();
vi.mock("../../src/repositories/file-system", () => ({
  appPaths: async () => ({ settingsFile: "/root/settings.json" }),
  readJsonFileResult: (p: string) => readJsonFileResult(p),
  writeJsonFile: (p: string, _format: string, d: unknown) => writeJsonFile(p, d),
  withSerial: (_p: string, fn: () => unknown) => fn(),
}));
vi.mock("../../src/repositories/logging", () => ({ log: { warn: (...args: unknown[]) => warn(...args) } }));
import { createDefaultSettings } from "../../src/models";

type SettingsRepository = typeof import("../../src/repositories/settings-repository");
let initializeSettings: SettingsRepository["initializeSettings"];

const PATH = "/root/settings.json";

beforeEach(async () => {
  vi.resetModules();
  ({ initializeSettings } = await import("../../src/repositories/settings-repository"));
  readJsonFileResult.mockReset();
  writeJsonFile.mockReset();
  warn.mockReset();
});
const stored = (data: unknown) => readJsonFileResult.mockResolvedValue({ status: "success", data });

describe("settings sets", () => {
  it("loads one set without writing or seeding the others", async () => {
    stored({ theme: "dark" });
    const result = await initializeSettings();
    expect(result).toEqual({ status: "success", settings: {
      ...createDefaultSettings(), theme: "dark",
    }, filePath: PATH });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("starts from the built-ins without writing when the file is missing", async () => {
    readJsonFileResult.mockResolvedValue({ status: "missing" });
    expect(await initializeSettings()).toEqual({ status: "success", settings: createDefaultSettings(), filePath: PATH });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("refuses a file with keys it does not know, without rewriting it", async () => {
    stored({ theme: "dark", unknown: 42 });
    expect(await initializeSettings()).toEqual({ status: "invalid", message: "unrecognized app settings", filePath: PATH });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it.each([
    ["language", "xx", "system"], ["theme", "sepia", "system"],
    ["fontFamily", 42, ""], ["fontFamily", " Inter ", ""], ["timezone", 3, "system"], ["timezone", "Not/AZone", "system"],
    ["kickDistances", "nope", [5, 25]], ["kickDistances", [5, "25"], [5, 25]], ["kickDistances", [5, 5], [5, 25]], ["kickDistances", [1000], [5, 25]],
    ["dueSoonDays", "abc", 7], ["dueSoonDays", 100000000, 7], ["handledTasksPageSize", null, 50], ["handledTasksPageSize", -5, 50],
    ["confirmPermanentDeletions", "no", true],
  ])("reads an invalid %s set (%j) as its built-in and warns", async (key, value, fallback) => {
    stored({ [key as string]: value, theme: key === "theme" ? value : "dark" });
    const result = await initializeSettings();
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.settings[key as keyof typeof result.settings]).toEqual(fallback);
    expect(result.settings.theme).toBe(key === "theme" ? "system" : "dark");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toEqual({ path: PATH, key });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("warns on every load of an invalid set", async () => {
    stored({ theme: "sepia" });
    await initializeSettings();
    await initializeSettings();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("reads an absent time zone as the system token without a warning", async () => {
    stored({});
    const result = await initializeSettings();
    expect(result.status === "success" && result.settings.timezone).toBe("system");
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads a null time zone as an invalid set: its built-in, with a warning", async () => {
    stored({ timezone: null });
    const result = await initializeSettings();
    expect(result.status === "success" && result.settings.timezone).toBe("system");
    expect(warn).toHaveBeenCalledExactlyOnceWith("settings set is invalid; using built-in", { path: PATH, key: "timezone" });
  });

  it.each([
    { status: "invalid", message: "bad JSON" }, { status: "error", message: "EACCES" }, { status: "newer", formatVersion: 2 },
  ])("propagates an unsuccessful read without writing", async (result) => {
    readJsonFileResult.mockResolvedValue(result);
    expect(await initializeSettings()).toEqual({ ...result, filePath: PATH });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
});
