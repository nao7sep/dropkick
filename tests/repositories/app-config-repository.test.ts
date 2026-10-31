import { describe, it, expect, beforeEach, vi } from "vitest";
const readJsonFileResult = vi.fn();
const writeJsonFile = vi.fn();
const quarantineFile = vi.fn();
const warn = vi.fn();
vi.mock("../../src/repositories/file-system", () => ({
  readJsonFileResult: (p: string) => readJsonFileResult(p),
  writeJsonFile: (p: string, _format: string, d: unknown) => writeJsonFile(p, d),
  quarantineFile: (p: string) => quarantineFile(p),
  appPaths: async () => ({ configFile: "/root/config.json" }),
  withSerial: (_p: string, fn: () => unknown) => fn(),
}));
vi.mock("../../src/repositories/logging", () => ({ log: { warn: (...args: unknown[]) => warn(...args) } }));
import { loadAppConfig, flushAppConfig } from "../../src/repositories/app-config-repository";
const defaults = { knownWorkspaces: [] };
beforeEach(() => {
  readJsonFileResult.mockReset(); writeJsonFile.mockReset(); warn.mockReset();
  quarantineFile.mockReset().mockResolvedValue("/root/config-stamp.invalid");
});

describe("saved-workspace config sets", () => {
  it("starts with an empty workspace list without creating config.json", async () => {
    readJsonFileResult.mockResolvedValue({ status: "missing" });
    expect(await loadAppConfig()).toEqual({ appConfig: { knownWorkspaces: [] }, filePath: "/root/config.json", recovery: null });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
  it("writes only the set that differs from its built-in, without reading the file", async () => {
    await flushAppConfig("/root/config.json", () => ({ knownWorkspaces: ["/first.json", "/second.json"] }));
    expect(readJsonFileResult).not.toHaveBeenCalled();
    expect(writeJsonFile).toHaveBeenCalledWith("/root/config.json", { knownWorkspaces: ["/first.json", "/second.json"] });
  });
  it("writes every differing set from memory, dropping unknown keys and sets equal to their built-in", async () => {
    readJsonFileResult.mockResolvedValue({ status: "success", data: { knownWorkspaces: ["/old.json"], version: "999", unknown: true } });
    const { appConfig } = await loadAppConfig();
    await flushAppConfig("/root/config.json", () => ({ ...appConfig, knownWorkspaces: ["/new.json"] }));
    expect(writeJsonFile).toHaveBeenCalledWith("/root/config.json", { knownWorkspaces: ["/new.json"] });
  });
  it("writes an empty map when every set is back at its built-in", async () => {
    await flushAppConfig("/root/config.json", () => defaults);
    expect(writeJsonFile).toHaveBeenCalledWith("/root/config.json", {});
  });
  it("heals an invalid set at the next save", async () => {
    readJsonFileResult.mockResolvedValue({ status: "success", data: { knownWorkspaces: "not a list" } });
    const { appConfig } = await loadAppConfig();
    await flushAppConfig("/root/config.json", () => appConfig);
    expect(writeJsonFile).toHaveBeenCalledWith("/root/config.json", {});
  });
  it.each(["not a list", ["/valid.json", {}], null])("reads an invalid set as its built-in and warns (%j)", async (knownWorkspaces) => {
    readJsonFileResult.mockResolvedValue({ status: "success", data: { knownWorkspaces } });
    expect((await loadAppConfig()).appConfig).toEqual(defaults);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][1].key).toBe("knownWorkspaces");
    expect(quarantineFile).not.toHaveBeenCalled();
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
  it.each([{ status: "invalid", message: "bad JSON" }, { status: "success", data: null }])("quarantines an unreadable map and leaves it absent", async (result) => {
    readJsonFileResult.mockResolvedValue(result);
    expect(await loadAppConfig()).toEqual({
      appConfig: defaults,
      filePath: "/root/config.json",
      recovery: { kind: "quarantined", quarantinedTo: "/root/config-stamp.invalid" },
    });
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
