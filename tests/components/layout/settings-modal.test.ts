// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsModal } from "../../../src/components/layout/SettingsModal";
import { createDefaultPreferences } from "../../../src/models";
import { usePreferencesStore } from "../../../src/state/preferences-store";
import { mount } from "../../helpers/react-dom";
import type { Mounted } from "../../helpers/react-dom";

const update = vi.fn();
const onClose = vi.fn();
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
  onClose.mockReset();
  host = await mount(createElement(SettingsModal, { onClose }));
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

  it("keeps a failed live theme save inside the open modal", async () => {
    update.mockResolvedValueOnce({ status: "error", message: "Theme could not be saved." });
    const select = document.querySelector('[aria-label="Theme"]') as HTMLSelectElement;

    await act(async () => {
      select.value = "dark";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Theme could not be saved.",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps a failed settings save inline and retains the edited draft", async () => {
    update.mockResolvedValueOnce({ status: "error", message: "Settings could not be saved." });
    const detect = [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Detect")!;
    await act(async () => detect.click());
    const timezone = document.querySelector('input[placeholder="System default"]') as HTMLInputElement;
    const retainedTimezone = timezone.value;
    const save = [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Save")!;
    await act(async () => save.click());

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Settings could not be saved.",
    );
    expect(timezone.value).toBe(retainedTimezone);
    expect(onClose).not.toHaveBeenCalled();
  });
});
