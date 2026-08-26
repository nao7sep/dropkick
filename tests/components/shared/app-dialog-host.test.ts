// @vitest-environment happy-dom
//
// The dialog host's focus rule, exercised against the real host rather than
// against the store that feeds it — the seam the store-level suite could never
// reach.
//
// The rule (modal-dialog-conventions): a confirmation never opens with focus on
// its destructive action, and where BOTH choices destroy something, none of them
// holds focus at all. What made it fail was not the rule but WHERE it ran: the
// store advances its queue by replacing `current` in a single `set` and never
// passes through null, so `Dialog.Content` stays mounted and a mount-only
// callback fires for the first request and no other. Every spec here therefore
// checks a QUEUED request as well as a first one; a rule that only holds for the
// first is the defect.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { mount } from "../../helpers/react-dom";
import type { Mounted } from "../../helpers/react-dom";
import { AppDialogHost } from "../../../src/components/shared/AppDialogHost";
import {
  useDialogStore,
  showAppConfirm,
  showAppMessage,
} from "../../../src/state/dialog-store";

let host: Mounted;

// The focused control, named the way a user would name it: the button's label,
// or "the dialog surface" when focus is on the dialog itself.
function focusedControl(): string {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return "nothing";
  if (active.getAttribute("role") === "dialog") return "the dialog surface";
  if (active.tagName === "BUTTON") return active.textContent ?? "";
  return `${active.tagName.toLowerCase()}`;
}

beforeEach(async () => {
  useDialogStore.setState({ current: null, queue: [] });
  host = await mount(createElement(AppDialogHost));
});

afterEach(async () => {
  await host.unmount();
});

async function open(
  request: () => void,
): Promise<void> {
  await act(async () => {
    request();
  });
}

// Answers the current dialog, letting whatever is queued behind it take over.
async function answerCurrent(how: "confirm" | "cancel"): Promise<void> {
  await act(async () => {
    if (how === "confirm") useDialogStore.getState().confirmCurrent();
    else useDialogStore.getState().cancelCurrent();
  });
}

describe("focus on the first request", () => {
  it("gives a confirmation's Cancel the focus, never its destructive action", async () => {
    await open(() => void showAppConfirm("Delete Task", "b", { confirmLabel: "Delete" }));

    expect(focusedControl()).toBe("Cancel");
  });

  it("gives a no-safe-action confirmation's focus to the surface, so Enter does nothing", async () => {
    await open(() =>
      void showAppConfirm("File Modified Externally", "b", {
        confirmLabel: "Overwrite",
        cancelLabel: "Discard & Reload",
        noSafeAction: true,
      }),
    );

    expect(focusedControl()).toBe("the dialog surface");
  });

  it("gives a message dialog's only button the focus", async () => {
    await open(() => void showAppMessage("Saved", "b"));

    expect(focusedControl()).toBe("OK");
  });

  it("keeps Cancel focused while rendering permanent deletion as danger", async () => {
    await open(() =>
      void showAppConfirm("Delete Task", "b", {
        tone: "danger",
        confirmLabel: "Delete",
      }),
    );

    expect(focusedControl()).toBe("Cancel");
    expect(
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "Delete",
      )?.className,
    ).toContain("bg-danger-solid");
  });
});

describe("focus on a queued request", () => {
  it("moves focus off the previous dialog's button and onto the queued confirmation's Cancel", async () => {
    // A message and a confirm raised from two independent async chains — the
    // shape reached by editing a task title and then clicking Delete.
    await open(() => void showAppMessage("Task Update Failed", "b"));
    await open(() => void showAppConfirm("Delete Task", "b", { confirmLabel: "Delete" }));
    expect(focusedControl()).toBe("OK"); // the message is still the one showing

    await answerCurrent("confirm");

    expect(useDialogStore.getState().current?.title).toBe("Delete Task");
    expect(focusedControl()).toBe("Cancel");
  });

  it("applies noSafeAction to a queued dialog, not just to a first one", async () => {
    await open(() => void showAppConfirm("Delete Task", "b", { confirmLabel: "Delete" }));
    await open(() =>
      void showAppConfirm("File Modified Externally", "b", {
        confirmLabel: "Overwrite",
        cancelLabel: "Discard & Reload",
        noSafeAction: true,
      }),
    );

    await answerCurrent("cancel");

    expect(useDialogStore.getState().current?.title).toBe("File Modified Externally");
    expect(focusedControl()).toBe("the dialog surface");
  });

  it("does not leave focus on the surface once a queued dialog has a safe action", async () => {
    await open(() =>
      void showAppConfirm("File Modified Externally", "b", { noSafeAction: true }),
    );
    await open(() => void showAppConfirm("Delete Task", "b", { confirmLabel: "Delete" }));

    await answerCurrent("cancel");

    expect(focusedControl()).toBe("Cancel");
  });

  it("keeps the rule for a third request behind two others", async () => {
    await open(() => void showAppMessage("First", "b"));
    await open(() => void showAppConfirm("Second", "b"));
    await open(() =>
      void showAppConfirm("Third", "b", { noSafeAction: true }),
    );

    await answerCurrent("confirm");
    expect(focusedControl()).toBe("Cancel");

    await answerCurrent("cancel");
    expect(useDialogStore.getState().current?.title).toBe("Third");
    expect(focusedControl()).toBe("the dialog surface");
  });
});

describe("dismissing a no-safe-action dialog", () => {
  it("ignores Escape, because dismissing would pick a destructive action", async () => {
    let settled: boolean | null = null;
    await open(() =>
      void showAppConfirm("File Modified Externally", "b", {
        confirmLabel: "Overwrite",
        cancelLabel: "Discard & Reload",
        noSafeAction: true,
      }).then((answer) => {
        settled = answer;
      }),
    );

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    // Still open, still unanswered: the user must choose one of the two.
    expect(settled).toBeNull();
    expect(document.querySelector("[role=dialog]")).not.toBeNull();
  });

  it("still lets Escape cancel a dialog that has a safe action", async () => {
    let settled: boolean | null = null;
    await open(() =>
      void showAppConfirm("Delete Task", "b", { confirmLabel: "Delete" }).then(
        (answer) => {
          settled = answer;
        },
      ),
    );

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(settled).toBe(false);
  });
});
