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
});
