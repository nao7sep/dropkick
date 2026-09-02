// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { ToastHost } from "../../../src/components/shared/ToastHost";
import { useToastStore } from "../../../src/state/toast-store";
import { mount } from "../../helpers/react-dom";
import type { Mounted } from "../../helpers/react-dom";

let host: Mounted;

beforeEach(() => {
  useToastStore.setState({
    message: null,
    token: 0,
    backgroundWriteError: null,
  });
});

afterEach(async () => {
  await host?.unmount();
});

describe("ToastHost result channels", () => {
  it("keeps a persistent structural alert beside transient no-op feedback", async () => {
    useToastStore.getState().showBackgroundWriteError(
      "Your window layout",
      "Your window layout could not be saved.",
    );
    useToastStore.getState().showToast("This action is unavailable here.");

    host = await mount(createElement(ToastHost));

    const alert = document.querySelector('[role="alert"]');
    const status = document.querySelector('[role="status"]');
    expect(alert?.textContent).toContain("could not be saved");
    expect(alert?.querySelectorAll("svg")).toHaveLength(1);
    expect(status?.textContent).toContain("unavailable");

    await act(async () => {
      (alert?.querySelector("button") as HTMLButtonElement).click();
    });
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="status"]')).not.toBeNull();
  });
});
