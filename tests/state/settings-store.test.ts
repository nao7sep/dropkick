import { message } from "../../src/i18n/translate";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SettingsDto } from "../../src/models";

const initializeSettings = vi.fn();
const flushSettings = vi.fn();

vi.mock("../../src/repositories", () => ({
  initializeSettings: () => initializeSettings(),
  flushSettings: (p: string, getPrefs: () => SettingsDto) => flushSettings(p, getPrefs),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useSettingsStore } from "../../src/state/settings-store";
import { createDefaultSettings } from "../../src/models";

beforeEach(() => {
  initializeSettings.mockReset();
  flushSettings.mockReset();
  useSettingsStore.setState({
    settings: createDefaultSettings(),
    filePath: "",
    loaded: false,
  });
});

describe("load", () => {
  it("sets settings, file path, and loaded flag on success", async () => {
    const prefs = { ...createDefaultSettings(), dueSoonDays: 3 };
    initializeSettings.mockResolvedValue({ status: "success", settings: prefs, filePath: "/prefs.json" });

    const result = await useSettingsStore.getState().initialize();
    expect(result.status).toBe("success");
    const state = useSettingsStore.getState();
    expect(state.settings.dueSoonDays).toBe(3);
    expect(state.filePath).toBe("/prefs.json");
    expect(state.loaded).toBe(true);
  });

  it("returns the failure result and leaves state untouched on non-success", async () => {
    initializeSettings.mockResolvedValue({ status: "error", message: "bad" });
    const result = await useSettingsStore.getState().initialize();
    expect(result).toEqual({ status: "error", message: "bad" });
    expect(useSettingsStore.getState().loaded).toBe(false);
  });
});

describe("update", () => {
  it("applies the change before its write reads the store", async () => {
    useSettingsStore.setState({ filePath: "/p.json" });
    let written: number | undefined;
    flushSettings.mockImplementation(async (_p, getPrefs: () => SettingsDto) => {
      written = getPrefs().dueSoonDays;
    });
    await useSettingsStore.getState().update({ dueSoonDays: 10 });
    expect(written).toBe(10);
  });

  it("does not flush when no file path is set", async () => {
    await useSettingsStore.getState().update({ handledTasksPageSize: 25 });
    expect(useSettingsStore.getState().settings.handledTasksPageSize).toBe(25);
    expect(flushSettings).not.toHaveBeenCalled();
  });

  it("rolls back its optimistic fields after a failed write so Save can retry", async () => {
    initializeSettings.mockResolvedValue({ status: "success", settings: createDefaultSettings(), filePath: "/p.json" });
    await useSettingsStore.getState().initialize();
    flushSettings.mockRejectedValue(new Error("disk full"));

    const result = await useSettingsStore.getState().update({ dueSoonDays: 10 });

    expect(result).toEqual({
      status: "error",
      message: message("write.settings"),
    });
    expect(useSettingsStore.getState().settings.dueSoonDays).toBe(7);
  });

  it("runs a later change only after the earlier write settles", async () => {
    useSettingsStore.setState({ filePath: "/p.json" });
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve; });
    flushSettings
      .mockImplementationOnce(async () => { await firstHeld; })
      .mockImplementationOnce(async () => {});

    const first = useSettingsStore.getState().update({ dueSoonDays: 10 });
    const second = useSettingsStore.getState().update({ theme: "dark" });
    await Promise.resolve();
    expect(useSettingsStore.getState().settings.theme).not.toBe("dark");

    releaseFirst();
    await Promise.all([first, second]);

    const settings = useSettingsStore.getState().settings;
    expect(settings.dueSoonDays).toBe(10);
    expect(settings.theme).toBe("dark");
  });

  it("restores only a failed later change's own fields", async () => {
    useSettingsStore.setState({ filePath: "/p.json" });
    flushSettings
      .mockImplementationOnce(async () => {})
      .mockRejectedValueOnce(new Error("second write failed"));

    const first = useSettingsStore.getState().update({ dueSoonDays: 10 });
    const second = useSettingsStore.getState().update({ theme: "dark" });
    expect(await first).toEqual({ status: "success" });
    expect((await second).status).toBe("error");

    const settings = useSettingsStore.getState().settings;
    expect(settings.dueSoonDays).toBe(10);
    expect(settings.theme).toBe(createDefaultSettings().theme);
  });
});
