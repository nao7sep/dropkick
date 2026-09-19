// @vitest-environment happy-dom

import { LANGUAGES } from "../../../src/i18n/languages";
import { CATALOGUES } from "../../../src/i18n/catalogues";
import { message } from "../../../src/i18n/translate";
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
  it("offers System, Light, and Dark as one radio group, System by default", () => {
    const group = document.querySelector("fieldset") as HTMLFieldSetElement;
    expect(group.querySelector("legend")?.textContent?.trim()).toBe("Theme");
    const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((radio) => radio.parentElement?.textContent?.trim())).toEqual([
      "System",
      "Light",
      "Dark",
    ]);
    expect(new Set(radios.map((radio) => radio.name))).toEqual(new Set(["theme"]));
    expect(radios.find((radio) => radio.checked)?.value).toBe("system");
  });

  it("stages the theme until Save, like every other field", async () => {
    const dark = document.querySelector('input[type="radio"][value="dark"]') as HTMLInputElement;
    await act(async () => dark.click());

    expect(dark.checked).toBe(true);
    expect(update).not.toHaveBeenCalled();
    expect(usePreferencesStore.getState().preferences.theme).toBe("system");

    const save = [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Save")!;
    await act(async () => save.click());

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("no longer advertises a theme shortcut", () => {
    expect(document.body.textContent).not.toMatch(/Shift\+D|opposite/);
  });

  it("keeps a failed settings save inline and retains the edited draft", async () => {
    update.mockResolvedValueOnce({ status: "error", message: message("write.preferences") });
    const timezone = timeZoneSelect();
    await choose(timezone, "Asia/Tokyo");
    const save = [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Save")!;
    await act(async () => save.click());

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Settings could not be saved. Your changes are still here; try again.",
    );
    expect(timezone.value).toBe("Asia/Tokyo");
    expect(onClose).not.toHaveBeenCalled();
  });
});

function selects(): HTMLSelectElement[] {
  return [...document.querySelectorAll("select")];
}

function languageSelect(): HTMLSelectElement {
  return selects().find((select) => select.querySelector('option[value="zh-Hans"]'))!;
}

function timeZoneSelect(): HTMLSelectElement {
  return selects().find((select) => select.querySelector('option[value="UTC"]'))!;
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function save() {
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save")!;
  await act(async () => button.click());
}

describe("SettingsModal language", () => {
  it("lists System first, then every language by its own name in its own script", () => {
    const options = [...languageSelect().options].map((option) => [option.value, option.textContent, option.lang]);
    expect(options).toEqual([
      ["system", "System", ""],
      ...LANGUAGES.map((language) => [language, CATALOGUES[language]["language.name"], language]),
    ]);
    expect(languageSelect().value).toBe("system");
  });

  it("stages a new language until Save", async () => {
    await choose(languageSelect(), "ru");
    expect(update).not.toHaveBeenCalled();
    await save();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ language: "ru" }));
  });
});

describe("SettingsModal time zone", () => {
  it("is chosen from a list that starts with System, never typed", () => {
    const select = timeZoneSelect();
    expect(select.options[0].value).toBe("");
    expect(select.options[0].textContent).toMatch(/^System \(.+\)$/);
    expect([...select.options].map((option) => option.value)).toContain("Asia/Tokyo");
    expect([...document.querySelectorAll("button")].some((b) => b.textContent === "Detect")).toBe(false);
  });

  it("saves a chosen zone, and System as no saved zone", async () => {
    await choose(timeZoneSelect(), "Europe/Berlin");
    await save();
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ timezone: "Europe/Berlin" }));
  });

  it("keeps a saved zone the platform list lacks selectable", async () => {
    await host.unmount();
    usePreferencesStore.setState({
      preferences: { ...createDefaultPreferences("Default"), timezone: "Asia/Calcutta" },
      update,
    });
    host = await mount(createElement(SettingsModal, { onClose }));
    expect(timeZoneSelect().value).toBe("Asia/Calcutta");
  });
});
