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
    expect(document.activeElement).toBe(owners[0]);
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

  it("describes the theme shortcut without implying that System is binary", async () => {
    host = await mount(createElement(KeyboardShortcutsModal, { onClose: () => {} }));

    expect(document.body.textContent).toContain(
      "Switch light/dark appearance",
    );
    expect(document.body.textContent).not.toContain("Toggle dark mode");
  });
});
