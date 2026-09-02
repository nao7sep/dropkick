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
