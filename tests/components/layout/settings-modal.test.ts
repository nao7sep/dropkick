// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsModal } from "../../../src/components/layout/SettingsModal";
import { createDefaultPreferences } from "../../../src/models";
import { usePreferencesStore } from "../../../src/state/preferences-store";
import { mount } from "../../helpers/react-dom";
import type { Mounted } from "../../helpers/react-dom";

const update = vi.fn();
let host: Mounted;

beforeEach(async () => {
  update.mockReset().mockImplementation(async (changes) => {
    usePreferencesStore.setState((state) => ({
      preferences: { ...state.preferences, ...changes },
    }));
    return { status: "success" };
  });
  usePreferencesStore.setState({
    preferences: createDefaultPreferences("Default"),
    update,
  });
  host = await mount(createElement(SettingsModal, { onClose: () => {} }));
});

afterEach(async () => {
  await host.unmount();
});

describe("SettingsModal theme", () => {
  it("defaults to System and offers all three live theme policies", async () => {
    const select = document.querySelector("select") as HTMLSelectElement;
    expect(select.getAttribute("aria-label")).toBe("Theme");
    expect(select.value).toBe("system");
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "System",
      "Light",
      "Dark",
    ]);

    await act(async () => {
      select.value = "dark";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(update).toHaveBeenCalledWith({ theme: "dark" });
  });
});
