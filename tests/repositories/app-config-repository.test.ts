import { describe, it, expect, beforeEach, vi } from "vitest";
const readJsonFileResult = vi.fn();
const writeJsonFile = vi.fn();
const quarantineFile = vi.fn();
const warn = vi.fn();
vi.mock("../../src/repositories/file-system", () => ({
  readJsonFileResult: (p: string) => readJsonFileResult(p),
  writeJsonFile: (p: string, d: unknown) => writeJsonFile(p, d),
  quarantineFile: (p: string) => quarantineFile(p),
  appPaths: async () => ({ configFile: "/root/config.json", preferencesFile: "/root/preferences.json", workspaceFile: "/root/workspace.json" }),
  withSerial: (_p: string, fn: () => unknown) => fn(),
}));
vi.mock("../../src/repositories/logging", () => ({ log: { warn: (...args: unknown[]) => warn(...args) } }));
import { loadAppConfig, flushAppConfig } from "../../src/repositories/app-config-repository";
const defaults = { knownPreferences: ["/root/preferences.json"], knownWorkspaces: ["/root/workspace.json"] };
beforeEach(() => {
  readJsonFileResult.mockReset(); writeJsonFile.mockReset(); warn.mockReset();
  quarantineFile.mockReset().mockResolvedValue("/root/config-stamp.invalid");
});

describe("known-document config sets", () => {
  it("uses the built-in lists on first run without creating config.json", async () => {
    readJsonFileResult.mockResolvedValue({ status: "missing" });
    expect(await loadAppConfig()).toEqual({ appConfig: defaults, filePath: "/root/config.json", quarantinedTo: null });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
  it("reads one whole set while the other remains its live built-in", async () => {
    readJsonFileResult.mockResolvedValue({ status: "success", data: { knownWorkspaces: [] } });
    expect((await loadAppConfig()).appConfig).toEqual({ ...defaults, knownWorkspaces: [] });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
  it("writes exactly one changed list on the first change", async () => {
    readJsonFileResult.mockResolvedValue({ status: "missing" });
    await flushAppConfig("/root/config.json", () => ({ ...defaults, knownWorkspaces: [...defaults.knownWorkspaces, "/second.json"] }), ["knownWorkspaces"]);
    expect(writeJsonFile).toHaveBeenCalledWith("/root/config.json", { knownWorkspaces: ["/root/workspace.json", "/second.json"] });
  });
  it("re-reads existing sets and removes unknown and version keys on the next write", async () => {
    readJsonFileResult.mockResolvedValue({ status: "success", data: { knownPreferences: ["/external.json"], version: "999", unknown: true } });
    await flushAppConfig("/root/config.json", () => ({ ...defaults, knownWorkspaces: ["/new.json"] }), ["knownWorkspaces"]);
    expect(writeJsonFile).toHaveBeenCalledWith("/root/config.json", { knownPreferences: ["/external.json"], knownWorkspaces: ["/new.json"] });
  });
  it.each(["not a list", ["/valid.json", {}], null])("reads a malformed set as absent and logs once (%j)", async (knownPreferences) => {
    readJsonFileResult.mockResolvedValue({ status: "success", data: { knownPreferences, knownWorkspaces: ["/valid.json"] } });
    expect((await loadAppConfig()).appConfig).toEqual({ ...defaults, knownWorkspaces: ["/valid.json"] });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][1].key).toBe("knownPreferences");
    expect(quarantineFile).not.toHaveBeenCalled();
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
  it.each([{ status: "invalid", message: "bad JSON" }, { status: "success", data: null }])("quarantines an unreadable map and leaves it absent", async (result) => {
    readJsonFileResult.mockResolvedValue(result);
    expect(await loadAppConfig()).toEqual({ appConfig: defaults, filePath: "/root/config.json", quarantinedTo: "/root/config-stamp.invalid" });
    expect(quarantineFile).toHaveBeenCalledWith("/root/config.json");
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
  it("propagates a failed quarantine without writing over the file", async () => {
    readJsonFileResult.mockResolvedValue({ status: "invalid", message: "bad JSON" });
    quarantineFile.mockRejectedValue(new Error("EACCES"));
    await expect(loadAppConfig()).rejects.toThrow("EACCES");
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
  it("halts on an I/O error and leaves the existing bytes alone", async () => {
    readJsonFileResult.mockResolvedValue({ status: "error", message: "EACCES" });
    await expect(loadAppConfig()).rejects.toThrow("EACCES");
    expect(quarantineFile).not.toHaveBeenCalled();
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
});
