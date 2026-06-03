import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PreferencesDto } from "../models";

const loadPreferences = vi.fn();
const flushPreferences = vi.fn();

vi.mock("../repositories", () => ({
  loadPreferences: (p: string) => loadPreferences(p),
  flushPreferences: (p: string, getPrefs: () => PreferencesDto) => flushPreferences(p, getPrefs),
}));

import { usePreferencesStore } from "./preferences-store";
import { createDefaultPreferences } from "../models";

beforeEach(() => {
  loadPreferences.mockReset();
  flushPreferences.mockReset();
  usePreferencesStore.setState({
    preferences: createDefaultPreferences("Default"),
    filePath: "",
    loaded: false,
  });
});

describe("load", () => {
  it("sets preferences, file path, and loaded flag on success", async () => {
    const prefs = { ...createDefaultPreferences("Loaded"), dueSoonDays: 3 };
    loadPreferences.mockResolvedValue({ status: "success", preferences: prefs });

    const result = await usePreferencesStore.getState().load("/prefs.json");
    expect(result.status).toBe("success");
    const state = usePreferencesStore.getState();
    expect(state.preferences.dueSoonDays).toBe(3);
    expect(state.filePath).toBe("/prefs.json");
    expect(state.loaded).toBe(true);
  });

  it("returns the failure result and leaves state untouched on non-success", async () => {
    loadPreferences.mockResolvedValue({ status: "error", message: "bad" });
    const result = await usePreferencesStore.getState().load("/prefs.json");
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
    await usePreferencesStore.getState().update({ zoomLevel: 2 });
    expect(usePreferencesStore.getState().preferences.zoomLevel).toBe(2);
    expect(flushPreferences).not.toHaveBeenCalled();
  });

  it("absorbs repository normalization back into state", async () => {
    usePreferencesStore.setState({ filePath: "/p.json" });
    // Repository coerces an invalid timezone to null on save.
    flushPreferences.mockImplementation(async (_p, getPrefs: () => PreferencesDto) => ({
      ...getPrefs(),
      timezone: null,
    }));

    await usePreferencesStore.getState().update({ timezone: "Bad/Zone" });
    expect(flushPreferences).toHaveBeenCalledTimes(1);
    expect(usePreferencesStore.getState().preferences.timezone).toBeNull();
  });
});
