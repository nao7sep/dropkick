import { message } from "../../src/i18n/translate";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PreferencesDto } from "../../src/models";

const initializePreferences = vi.fn();
const flushPreferences = vi.fn();

vi.mock("../../src/repositories", () => ({
  initializePreferences: () => initializePreferences(),
  flushPreferences: (p: string, getPrefs: () => PreferencesDto) => flushPreferences(p, getPrefs),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { usePreferencesStore } from "../../src/state/preferences-store";
import { createDefaultPreferences } from "../../src/models";

beforeEach(() => {
  initializePreferences.mockReset();
  flushPreferences.mockReset();
  usePreferencesStore.setState({
    preferences: createDefaultPreferences(),
    filePath: "",
    loaded: false,
  });
});

describe("load", () => {
  it("sets preferences, file path, and loaded flag on success", async () => {
    const prefs = { ...createDefaultPreferences(), dueSoonDays: 3 };
    initializePreferences.mockResolvedValue({ status: "success", preferences: prefs, filePath: "/prefs.json" });

    const result = await usePreferencesStore.getState().initialize();
    expect(result.status).toBe("success");
    const state = usePreferencesStore.getState();
    expect(state.preferences.dueSoonDays).toBe(3);
    expect(state.filePath).toBe("/prefs.json");
    expect(state.loaded).toBe(true);
  });

  it("returns the failure result and leaves state untouched on non-success", async () => {
    initializePreferences.mockResolvedValue({ status: "error", message: "bad" });
    const result = await usePreferencesStore.getState().initialize();
    expect(result).toEqual({ status: "error", message: "bad" });
    expect(usePreferencesStore.getState().loaded).toBe(false);
  });
});

describe("update", () => {
  it("applies changes synchronously before any flush resolves", () => {
    usePreferencesStore.setState({ filePath: "/p.json" });
    flushPreferences.mockResolvedValue(usePreferencesStore.getState().preferences);
    void usePreferencesStore.getState().update({ dueSoonDays: 10 });
    // The synchronous set ran already, even though the flush promise is pending.
    expect(usePreferencesStore.getState().preferences.dueSoonDays).toBe(10);
  });

  it("does not flush when no file path is set", async () => {
    await usePreferencesStore.getState().update({ handledTasksPageSize: 25 });
    expect(usePreferencesStore.getState().preferences.handledTasksPageSize).toBe(25);
    expect(flushPreferences).not.toHaveBeenCalled();
  });

  it("rolls back its optimistic fields after a failed write so Save can retry", async () => {
    initializePreferences.mockResolvedValue({ status: "success", preferences: createDefaultPreferences(), filePath: "/p.json" });
    await usePreferencesStore.getState().initialize();
    flushPreferences.mockRejectedValue(new Error("disk full"));

    const result = await usePreferencesStore.getState().update({ dueSoonDays: 10 });

    expect(result).toEqual({
      status: "error",
      message: message("write.preferences"),
    });
    expect(usePreferencesStore.getState().preferences.dueSoonDays).toBe(7);
  });

  it("does not let an older write completion erase a newer update", async () => {
    usePreferencesStore.setState({ filePath: "/p.json" });
    let resolveFirst!: () => void;
    flushPreferences
      .mockImplementationOnce(
        async (_p, getPrefs: () => PreferencesDto) => {
          const snapshot = getPrefs();
          return await new Promise<PreferencesDto>((resolve) => {
            resolveFirst = () => resolve(snapshot);
          });
        },
      )
      .mockImplementationOnce(async (_p, getPrefs: () => PreferencesDto) =>
        getPrefs(),
      );

    const first = usePreferencesStore.getState().update({ dueSoonDays: 10 });
    const second = usePreferencesStore.getState().update({ theme: "dark" });
    expect(usePreferencesStore.getState().preferences.theme).toBe("dark");

    resolveFirst();
    await Promise.all([first, second]);

    const preferences = usePreferencesStore.getState().preferences;
    expect(preferences.dueSoonDays).toBe(10);
    expect(preferences.theme).toBe("dark");
  });

  it("keeps a later edit already captured by an earlier successful write", async () => {
    usePreferencesStore.setState({ filePath: "/p.json" });
    let releaseFirst!: () => void;
    flushPreferences
      .mockImplementationOnce(
        async (_p, getPrefs: () => PreferencesDto) => {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          return getPrefs();
        },
      )
      .mockRejectedValueOnce(new Error("second write failed"));

    const first = usePreferencesStore.getState().update({ dueSoonDays: 10 });
    const second = usePreferencesStore.getState().update({ theme: "dark" });
    releaseFirst();
    await first;
    await second;

    const preferences = usePreferencesStore.getState().preferences;
    expect(preferences.dueSoonDays).toBe(10);
    expect(preferences.theme).toBe("dark");
  });
});
