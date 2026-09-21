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

import { message } from "../../../src/i18n/translate";
import { inEnglish } from "../../helpers/i18n";
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
    await open(() => void showAppConfirm(message("dialog.deleteTask.title"), message("dialog.deleteNote.body"), { confirmLabel: message("dialog.delete") }));

    expect(focusedControl()).toBe("Cancel");
  });

  it("gives a no-safe-action confirmation's focus to the surface, so Enter does nothing", async () => {
    await open(() =>
      void showAppConfirm(message("dialog.fileConflict.title"), message("dialog.deleteNote.body"), {
        confirmLabel: message("dialog.fileConflict.overwrite"),
        cancelLabel: message("dialog.fileConflict.reload"),
        noSafeAction: true,
      }),
    );

    expect(focusedControl()).toBe("the dialog surface");
  });

  it("gives a message dialog's only button the focus", async () => {
    await open(() => void showAppMessage(message("startup.appStateReset.title"), message("dialog.deleteNote.body")));

    expect(focusedControl()).toBe("OK");
  });

  it("keeps Cancel focused while rendering permanent deletion as danger", async () => {
    await open(() =>
      void showAppConfirm(message("dialog.deleteTask.title"), message("dialog.deleteNote.body"), {
        tone: "danger",
        confirmLabel: message("dialog.delete"),
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
    await open(() => void showAppMessage(message("detail.priorityFailed"), message("dialog.deleteNote.body")));
    await open(() => void showAppConfirm(message("dialog.deleteTask.title"), message("dialog.deleteNote.body"), { confirmLabel: message("dialog.delete") }));
    expect(focusedControl()).toBe("OK"); // the message is still the one showing

    await answerCurrent("confirm");

    expect(inEnglish(useDialogStore.getState().current?.title)).toBe("Delete Task");
    expect(focusedControl()).toBe("Cancel");
  });

  it("applies noSafeAction to a queued dialog, not just to a first one", async () => {
    await open(() => void showAppConfirm(message("dialog.deleteTask.title"), message("dialog.deleteNote.body"), { confirmLabel: message("dialog.delete") }));
    await open(() =>
      void showAppConfirm(message("dialog.fileConflict.title"), message("dialog.deleteNote.body"), {
        confirmLabel: message("dialog.fileConflict.overwrite"),
        cancelLabel: message("dialog.fileConflict.reload"),
        noSafeAction: true,
      }),
    );

    await answerCurrent("cancel");

    expect(inEnglish(useDialogStore.getState().current?.title)).toBe("File Modified Externally");
    expect(focusedControl()).toBe("the dialog surface");
  });

  it("does not leave focus on the surface once a queued dialog has a safe action", async () => {
    await open(() =>
      void showAppConfirm(message("dialog.fileConflict.title"), message("dialog.deleteNote.body"), { noSafeAction: true }),
    );
    await open(() => void showAppConfirm(message("dialog.deleteTask.title"), message("dialog.deleteNote.body"), { confirmLabel: message("dialog.delete") }));

    await answerCurrent("cancel");

    expect(focusedControl()).toBe("Cancel");
  });

  it("keeps the rule for a third request behind two others", async () => {
    await open(() => void showAppMessage(message("startup.appStateReset.title"), message("dialog.deleteNote.body")));
    await open(() => void showAppConfirm(message("dialog.deleteTask.title"), message("dialog.deleteNote.body")));
    await open(() =>
      void showAppConfirm(message("dialog.fileConflict.title"), message("dialog.deleteNote.body"), { noSafeAction: true }),
    );

    await answerCurrent("confirm");
    expect(focusedControl()).toBe("Cancel");

    await answerCurrent("cancel");
    expect(inEnglish(useDialogStore.getState().current?.title)).toBe("File Modified Externally");
    expect(focusedControl()).toBe("the dialog surface");
  });
});

describe("dismissing a no-safe-action dialog", () => {
  it("ignores Escape, because dismissing would pick a destructive action", async () => {
    let settled: boolean | null = null;
    await open(() =>
      void showAppConfirm(message("dialog.fileConflict.title"), message("dialog.deleteNote.body"), {
        confirmLabel: message("dialog.fileConflict.overwrite"),
        cancelLabel: message("dialog.fileConflict.reload"),
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
      void showAppConfirm(message("dialog.deleteTask.title"), message("dialog.deleteNote.body"), { confirmLabel: message("dialog.delete") }).then(
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


describe("the surface's own bands", () => {
  it("bounds the surface and scrolls only the body, so the footer cannot be pushed off", async () => {
    // The host is the one place a body's length is not the app's to choose: a
    // conflict message carries whatever path the file system handed it. Without
    // a cap the surface grows past the viewport, and because it is centred on a
    // fixed layer both ends leave the screen with nothing able to scroll them
    // back — the buttons among them (modal-dialog-conventions). AppModal beside
    // it already takes this shape; this is the same one.
    await open(() =>
      void showAppConfirm(
        message("dialog.fileConflict.title"),
        message("dialog.fileConflict.body", { path: "/".concat("very-long-folder/".repeat(40), "notes.json") }),
        {
          confirmLabel: message("dialog.fileConflict.overwrite"),
          cancelLabel: message("dialog.fileConflict.reload"),
          noSafeAction: true,
        },
      ),
    );

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
