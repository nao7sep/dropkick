// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { mount } from "../../helpers/react-dom";
import type { Mounted } from "../../helpers/react-dom";
import { KeyboardShortcutsModal } from "../../../src/components/layout/KeyboardShortcutsModal";

let host: Mounted;

afterEach(async () => {
  await host?.unmount();
});

describe("KeyboardShortcutsModal tab commands", () => {
  it("uses one reachable passive scroll owner for the whole catalogue", async () => {
    host = await mount(createElement(KeyboardShortcutsModal, { onClose: () => {} }));

    const owners = document.querySelectorAll("[data-passive-scroll-region]");
    expect(owners).toHaveLength(1);
    expect(owners[0].getAttribute("aria-label")).toBe("Keyboard shortcuts");
    expect(owners[0].getAttribute("tabindex")).toBe("0");
    expect(owners[0].className).toContain("overflow-y-auto");
    expect(owners[0].querySelector(".overflow-y-auto")).toBeNull();
    // Reachable, not pre-focused. This owner reaches the modal's own edges, so
    // the ring it carries draws a second border just inside the surface — and a
    // reader who opened this with the mouse never asked for one. Tab reaches it,
    // and rings it, deliberately. (This assertion used to require the opposite.)
    expect(document.activeElement).toBe(document.querySelector('[role="dialog"]'));
  });

  it("leaves the height bound to the modal shell", async () => {
    host = await mount(createElement(KeyboardShortcutsModal, { onClose: () => {} }));

    // A second viewport height here is always the tighter of the two, so the
    // list stops short of the room the shell would have given it.
    const body = document.querySelector("[data-passive-scroll-region]")!;
    expect(body.className).not.toMatch(/max-h-\[\d+vh\]/);
    expect(body.className).toContain("min-h-0");
    expect(body.className).toContain("flex-1");
  });

  it("documents the keyboard-equivalent tab reorder", async () => {
    host = await mount(createElement(KeyboardShortcutsModal, { onClose: () => {} }));

    expect(document.body.textContent).toContain("Move focused tab (tab bar focused)");
    expect(document.body.textContent).toContain("Shift+Left/Right");
  });

  it("documents permanent task deletion separately from dismissal", async () => {
    host = await mount(createElement(KeyboardShortcutsModal, { onClose: () => {} }));

    expect(document.body.textContent).toContain("Set status to DismissedX");
    expect(document.body.textContent).toContain(
      "Delete selected tasksDelete/Backspace",
    );
    expect(document.body.textContent).not.toContain(
      "Dismiss selected tasksBackspace/Delete",
    );
  });

  it("lists no theme shortcut; the theme changes only in Settings", async () => {
    host = await mount(createElement(KeyboardShortcutsModal, { onClose: () => {} }));

    expect(document.body.textContent).not.toMatch(/appearance|dark mode|theme/i);
  });
});
