import { describe, it, expect, beforeEach, vi } from "vitest";
const readJsonFileResult = vi.fn();
const writeJsonFile = vi.fn();
const warn = vi.fn();
vi.mock("../../src/repositories/file-system", () => ({
  readJsonFileResult: (p: string) => readJsonFileResult(p),
  writeJsonFile: (p: string, _format: string, d: unknown) => writeJsonFile(p, d),
  appPaths: async () => ({ configFile: "/root/config.json" }),
  withSerial: (_p: string, fn: () => unknown) => fn(),
}));
vi.mock("../../src/repositories/logging", () => ({ log: { warn: (...args: unknown[]) => warn(...args) } }));
import { loadAppConfig, flushAppConfig } from "../../src/repositories/app-config-repository";
const defaults = { knownWorkspaces: [] };
const header = { format: { owner: "dropkick", kind: "config", version: 1 }, writer: { name: "dropkick", version: "1.0.0" } };
beforeEach(() => {
  readJsonFileResult.mockReset().mockResolvedValue({ status: "missing" });
  writeJsonFile.mockReset(); warn.mockReset();
});

describe("saved-workspace config sets", () => {
  it("starts with an empty workspace list without creating config.json", async () => {
    expect(await loadAppConfig()).toEqual({ appConfig: { knownWorkspaces: [] }, filePath: "/root/config.json", refusal: null });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
  it("writes only the set that differs from its built-in", async () => {
    await flushAppConfig("/root/config.json", () => ({ knownWorkspaces: ["/first.json", "/second.json"] }));
    expect(writeJsonFile).toHaveBeenCalledWith("/root/config.json", { knownWorkspaces: ["/first.json", "/second.json"] });
  });
  it("keeps keys it does not know, and drops sets equal to their built-in", async () => {
    readJsonFileResult.mockResolvedValue({ status: "success", data: { ...header, knownWorkspaces: ["/old.json"], laterSetting: { a: 1 } } });
    const { appConfig } = await loadAppConfig();
    await flushAppConfig("/root/config.json", () => ({ ...appConfig, knownWorkspaces: ["/new.json"] }));
    expect(writeJsonFile).toHaveBeenCalledWith("/root/config.json", { knownWorkspaces: ["/new.json"], laterSetting: { a: 1 } });
    await flushAppConfig("/root/config.json", () => defaults);
    expect(writeJsonFile).toHaveBeenLastCalledWith("/root/config.json", { laterSetting: { a: 1 } });
  });
  it("keeps an invalid set until the session changes it", async () => {
    readJsonFileResult.mockResolvedValue({ status: "success", data: { ...header, knownWorkspaces: "not a list" } });
    const { appConfig } = await loadAppConfig();
    await flushAppConfig("/root/config.json", () => appConfig);
    expect(writeJsonFile).toHaveBeenLastCalledWith("/root/config.json", { knownWorkspaces: "not a list" });
    await flushAppConfig("/root/config.json", () => ({ knownWorkspaces: ["/chosen.json"] }));
    expect(writeJsonFile).toHaveBeenLastCalledWith("/root/config.json", { knownWorkspaces: ["/chosen.json"] });
  });
  it.each(["not a list", ["/valid.json", {}], null])("reads an invalid set as its built-in and warns (%j)", async (knownWorkspaces) => {
    readJsonFileResult.mockResolvedValue({ status: "success", data: { knownWorkspaces } });
    expect((await loadAppConfig()).appConfig).toEqual(defaults);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][1].key).toBe("knownWorkspaces");
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
  it.each([
    [{ status: "invalid", message: "bad JSON" }, "unreadable"],
    [{ status: "success", data: null }, "unreadable"],
    [{ status: "error", message: "EACCES" }, "unreadable"],
    [{ status: "newer", formatVersion: 2 }, "newer"],
  ])("refuses %j for the launch, leaving it untouched with no file to write", async (result, reason) => {
    readJsonFileResult.mockResolvedValue(result);
    expect(await loadAppConfig()).toEqual({
      appConfig: defaults,
      filePath: "",
      refusal: { path: "/root/config.json", reason },
    });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
  it("refuses a save when the file has since become unreadable or newer", async () => {
    for (const result of [{ status: "invalid", message: "bad JSON" }, { status: "newer", formatVersion: 2 }]) {
      readJsonFileResult.mockResolvedValue(result);
      await expect(flushAppConfig("/root/config.json", () => ({ knownWorkspaces: ["/a.json"] }))).rejects.toThrow();
    }
    expect(writeJsonFile).not.toHaveBeenCalled();
  });
});
