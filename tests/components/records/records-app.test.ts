// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_UI_FONT_STACK } from "../../../src/models";
import type { RecordsContext } from "../../../src/models/records";
import { mount, type Mounted } from "../../helpers/react-dom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

const nativeWindow = vi.hoisted(() => ({ setTitle: vi.fn((_title: string) => Promise.resolve()) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => nativeWindow }));

const records = vi.hoisted(() => ({
  context: null as ((context: RecordsContext) => void) | null,
}));

vi.mock("../../../src/repositories/records", () => ({
  readRecordsPage: () => new Promise(() => {}),
  readRecordDetail: () => new Promise(() => {}),
  readRecordSources: () => new Promise(() => {}),
  commitRecordsListWidth: () => Promise.resolve(),
  onRecordsChanged: () => () => {},
  onRecordsContext: (listener: (context: RecordsContext) => void) => {
    records.context = listener;
    return () => {
      records.context = null;
    };
  },
}));

import { loadInterfaceCatalogue } from "../../../src/i18n/I18nContext";
import { RecordsApp } from "../../../src/components/records/RecordsApp";

class TestResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

let mounted: Mounted | null = null;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  document.documentElement.style.removeProperty("--font-ui");
  vi.unstubAllGlobals();
});

const listPane = () => document.querySelector<HTMLElement>('[role="listbox"]')!.closest("section")!;

describe("RecordsApp", () => {
  it("speaks the main window's language from its first text, at the width it was opened with", async () => {
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(document.body.textContent ?? ""));
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    mounted = await mount(createElement(RecordsApp, { search: "?listWidth=420&language=ja&locale=ja-JP" }));
    await act(async () => { await loadInterfaceCatalogue("ja"); });
    expect(document.body.textContent).toContain("ログを読み込み中…");
    observer.disconnect();

    expect(document.title).toBe("ログ");
    expect(seen.some((text) => text.includes("Loading records"))).toBe(false);
    expect(listPane().style.width).toBe("420px");
  });

  it("follows the main window when its language changes", async () => {
    mounted = await mount(createElement(RecordsApp, { search: "?language=en&locale=en-US" }));
    expect(document.body.textContent).toContain("Loading records…");

    await act(async () => records.context!({ language: "de", locale: "de-DE", timeZone: "Europe/Berlin", fontFamily: "" }));

    // The German catalogue loads first; until then the window keeps English.
    await act(async () => { await loadInterfaceCatalogue("de"); });
    expect(document.body.textContent).toContain("Protokoll wird geladen\u00a0…");
    expect(document.title).toBe("Protokoll");
    expect(nativeWindow.setTitle).toHaveBeenLastCalledWith("Protokoll");
  });

  it("uses the font it opens with and follows live font changes and reset", async () => {
    mounted = await mount(createElement(RecordsApp, { search: "?fontFamily=++Example+UI++" }));
    expect(document.documentElement.style.getPropertyValue("--font-ui")).toBe(`Example UI, ${DEFAULT_UI_FONT_STACK}`);

    await act(async () => records.context!({ language: "en", locale: "en", timeZone: null, fontFamily: "Live UI" }));
    expect(document.documentElement.style.getPropertyValue("--font-ui")).toBe(`Live UI, ${DEFAULT_UI_FONT_STACK}`);

    await act(async () => records.context!({ language: "en", locale: "en", timeZone: null, fontFamily: "  " }));
    expect(document.documentElement.style.getPropertyValue("--font-ui")).toBe(DEFAULT_UI_FONT_STACK);
  });

  it("uses the default UI font for an address without a font setting", async () => {
    mounted = await mount(createElement(RecordsApp, { search: "" }));
    expect(document.documentElement.style.getPropertyValue("--font-ui")).toBe(DEFAULT_UI_FONT_STACK);
  });

  it("stops listening when it closes", async () => {
    mounted = await mount(createElement(RecordsApp, { search: "" }));
    expect(records.context).not.toBeNull();
    await mounted.unmount();
    mounted = null;
    expect(records.context).toBeNull();
  });
});
