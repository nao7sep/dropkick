// @vitest-environment happy-dom
//
// Escape belongs to the IME while a composition is active: it cancels the
// pending candidate and falls back to kana. Radix's dismissable layer matches
// `event.key === "Escape"` alone, on a document-CAPTURE listener that runs
// ahead of every React handler, so the app's own text fields cannot guard it —
// only the modal's onEscapeKeyDown callback can. This exercises the real modal
// rather than the predicate, because the predicate was never the missing half.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";
import { createElement, act } from "react";
import { mount } from "../../helpers/react-dom";
import type { Mounted } from "../../helpers/react-dom";
import { AppModal } from "../../../src/components/shared/AppModal";

let host: Mounted;

async function pressEscape(isComposing: boolean) {
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        // Radix's DismissableLayer only honours preventDefault() on a
        // cancelable event — a genuine Escape keypress is; this synthetic one
        // must say so too, or preventDefault() silently does nothing and the
        // dialog dismisses regardless of what onEscapeKeyDown decided.
        cancelable: true,
        // happy-dom's KeyboardEvent honours this in its init dict.
        isComposing,
      } as KeyboardEventInit),
    );
  });
}

afterEach(async () => {
  await host?.unmount();
});

describe("AppModal — Escape during an IME composition", () => {
  let onRequestClose: Mock<() => void>;

  beforeEach(async () => {
    onRequestClose = vi.fn<() => void>();
    host = await mount(
      createElement(AppModal, {
        title: "New Task",
        onClose: () => {},
        onRequestClose,
        children: createElement("div", null, "Body"),
        footer: createElement("button", null, "Save"),
      }),
    );
  });

  it("does not close while a composition is active", async () => {
    await pressEscape(true);
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("closes on a plain Escape", async () => {
    await pressEscape(false);
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("keeps result growth in the scrollable body with fixed header and footer", () => {
    const dialog = document.querySelector('[role="dialog"]')!;
    const bands = [...dialog.children] as HTMLElement[];

    expect(dialog.className).toContain("max-h-[90vh]");
    expect(dialog.className).toContain("flex-col");
    expect(bands[0].className).toContain("shrink-0");
    expect(bands[1].className).toContain("min-h-0");
    expect(bands[1].className).toContain("overflow-y-auto");
    expect(bands[2].className).toContain("shrink-0");
  });
});

describe("AppModal — an informational body", () => {
  beforeEach(async () => {
    host = await mount(
      createElement(AppModal, {
        title: "About",
        onClose: () => {},
        passiveBodyLabel: "About",
        children: createElement("div", null, "Body"),
        footer: createElement("button", null, "Close"),
      }),
    );
  });

  it("opens with focus on the surface rather than on the body that scrolls it", () => {
    // The body reaches the modal's own edges, so the focus ring a passive scroll
    // region carries draws a second border just inside the surface — and a reader
    // who opened this with the mouse never asked for one. The region stays
    // reachable, and rings correctly, on a deliberate Tab.
    const dialog = document.querySelector('[role="dialog"]')!;
    const body = document.querySelector("[data-passive-scroll-region]")!;

    expect(body).not.toBeNull();
    expect(document.activeElement).toBe(dialog);
    expect(document.activeElement).not.toBe(body);
  });
});

// A surface with nothing to close back to — the startup picker sits on the
// app's own canvas, not stacked over other content (modal-dialog-conventions:
// exempt root surface).
describe("AppModal — closable={false}, dimmed={false}", () => {
  const onClose = vi.fn();

  beforeEach(async () => {
    onClose.mockClear();
    host = await mount(
      createElement(AppModal, {
        title: "Startup",
        onClose,
        closable: false,
        dimmed: false,
        children: createElement("div", null, "Body"),
        footer: createElement("button", null, "Open"),
      }),
    );
  });

  it("renders no close control", () => {
    const header = document.querySelector('[role="dialog"] > div')!;
    expect(header.querySelectorAll("button")).toHaveLength(0);
  });

  it("does not close on Escape", async () => {
    await pressEscape(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("carries no backdrop tint", () => {
    const overlay = document.querySelector('[data-state="open"]:not([role="dialog"])')!;
    expect(overlay.className).not.toContain("bg-black/30");
  });
});
