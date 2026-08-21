// @vitest-environment happy-dom
//
// A bar of editing controls that reads as one thing should cost one Tab press,
// not one per control. The reorder bar's width is a user preference - every
// kick distance added is another button - so left as plain buttons, reaching
// the field below it got steadily more expensive.

import { describe, it, expect, afterEach } from "vitest";
import { createElement, act, useState } from "react";
import { mount } from "../../helpers/react-dom";
import type { Mounted } from "../../helpers/react-dom";
import { Toolbar } from "../../../src/components/shared/Toolbar";

let host: Mounted;

afterEach(async () => {
  await host?.unmount();
});

function buttons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("[role=toolbar] button"));
}

async function mountBar(labels = ["Tackle", "+5", "+25", "Kick", "Dropkick"]) {
  host = await mount(
    createElement(Toolbar, {
      label: "Task actions",
      children: labels.map((text) => createElement("button", { key: text }, text)),
    }),
  );
}

async function press(key: string) {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true }),
    );
  });
}

describe("Toolbar", () => {
  it("is one tab stop, however many controls it holds", async () => {
    await mountBar();
    const inTabOrder = buttons().filter((b) => b.tabIndex === 0);
    expect(buttons()).toHaveLength(5);
    expect(inTabOrder).toHaveLength(1);
  });

  it("moves between controls with the arrow keys", async () => {
    await mountBar();
    buttons()[0].focus();

    await press("ArrowRight");
    expect(document.activeElement?.textContent).toBe("+5");

    await press("ArrowLeft");
    expect(document.activeElement?.textContent).toBe("Tackle");
  });

  it("jumps to the ends with Home and End, and does not wrap", async () => {
    await mountBar();
    buttons()[0].focus();

    await press("End");
    expect(document.activeElement?.textContent).toBe("Dropkick");
    await press("ArrowRight");
    expect(document.activeElement?.textContent).toBe("Dropkick");

    await press("Home");
    expect(document.activeElement?.textContent).toBe("Tackle");
    await press("ArrowLeft");
    expect(document.activeElement?.textContent).toBe("Tackle");
  });

  it("keeps the focused control as the one tab stop", async () => {
    await mountBar();
    buttons()[0].focus();
    await press("ArrowRight");

    const inTabOrder = buttons().filter((b) => b.tabIndex === 0);
    expect(inTabOrder).toHaveLength(1);
    expect(inTabOrder[0].textContent).toBe("+5");
  });

  it("remembers the active control while focus is elsewhere and the bar rerenders", async () => {
    function Harness() {
      const [count, setCount] = useState(0);
      return createElement(
        "div",
        null,
        createElement(Toolbar, {
          label: "Task actions",
          children: ["Tackle", "+5", "+25"].map((text) =>
            createElement("button", { key: text }, text),
          ),
        }),
        createElement(
          "button",
          { onClick: () => setCount((value) => value + 1) },
          `Outside ${count}`,
        ),
      );
    }

    host = await mount(createElement(Harness));
    buttons()[0].focus();
    await press("ArrowRight");

    const outside = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.startsWith("Outside"),
    )!;
    outside.focus();
    await act(async () => outside.click());

    const inTabOrder = buttons().filter((button) => button.tabIndex === 0);
    expect(inTabOrder).toHaveLength(1);
    expect(inTabOrder[0].textContent).toBe("+5");
  });
});
