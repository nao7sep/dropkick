// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSystemDarkMode } from "../../src/hooks/useSystemDarkMode";
import { mount } from "../helpers/react-dom";
import type { Mounted } from "../helpers/react-dom";

let matches = false;
let listener: (() => void) | null = null;
let rendered: boolean | null = null;
let host: Mounted;

function Harness() {
  rendered = useSystemDarkMode();
  return null;
}

beforeEach(() => {
  matches = false;
  listener = null;
  rendered = null;
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return matches;
    },
    addEventListener: (_type: string, callback: () => void) => {
      listener = callback;
    },
    removeEventListener: (_type: string, callback: () => void) => {
      if (listener === callback) listener = null;
    },
  }));
});

afterEach(async () => {
  await host.unmount();
  vi.unstubAllGlobals();
});

describe("useSystemDarkMode", () => {
  it("tracks OS appearance changes", async () => {
    host = await mount(createElement(Harness));
    expect(rendered).toBe(false);

    await act(async () => {
      matches = true;
      listener?.();
    });

    expect(rendered).toBe(true);
  });
});
