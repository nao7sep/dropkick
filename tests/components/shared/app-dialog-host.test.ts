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
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { mount } from "../../helpers/react-dom";
import type { Mounted } from "../../helpers/react-dom";
import { AppDialogHost } from "../../../src/components/shared/AppDialogHost";
import {
  useDialogStore,
  showAppConfirm,
  showAppMessage,
} from "../../../src/state/dialog-store";

const shown = vi.hoisted(() => ({ showing: true, answer: null as string | null, asked: [] as string[][] }));
vi.mock("../../../src/repositories/window-activity", () => ({ isWindowShowing: async () => shown.showing }));
vi.mock("../../../src/repositories/dialogs", () => ({
  askStandalone: async (_title: string, _body: string, buttons: readonly string[]) => {
    shown.asked.push([...buttons]);
    return shown.answer;
  },
}));

let host: Mounted;

it("offers labelled Cancel, Retry and Quit Anyway with Cancel focused", async () => {
  let choice!: Promise<"quit" | "retry" | "cancel">;
  await open(() => { choice = useDialogStore.getState().enqueueQuitSave(["tasks.json"]); });
  expect([...document.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
    "Cancel", "Retry", "Quit Anyway",
  ]);
  expect(focusedControl()).toBe("Cancel");
  await answerCurrent("cancel");
  await expect(choice).resolves.toBe("cancel");
});

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
    await open(() => void showAppMessage(message("startup.appConfigReset.title"), message("dialog.deleteNote.body")));

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
    ).toContain("dk-btn-danger-confirm");
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
    await open(() => void showAppMessage(message("startup.appConfigReset.title"), message("dialog.deleteNote.body")));
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

describe("built on AppModal, with no close control and an inert backdrop", () => {
  it("renders no close button — every request forces an explicit footer choice", async () => {
    await open(() =>
      void showAppConfirm(message("dialog.deleteTask.title"), message("dialog.deleteNote.body"), {
        confirmLabel: message("dialog.delete"),
      }),
    );

    const header = document.querySelector('[role="dialog"] > div')!;
    expect(header.querySelectorAll("button")).toHaveLength(0);
  });

  it("ignores an outside click even on a dialog with a safe action — only the footer decides", async () => {
    let settled: boolean | null = null;
    await open(() =>
      void showAppConfirm(message("dialog.deleteTask.title"), message("dialog.deleteNote.body"), {
        confirmLabel: message("dialog.delete"),
      }).then((answer) => {
        settled = answer;
      }),
    );

    await act(async () => {
      // A pointerdown outside the dialog surface — Radix's outside-interaction
      // path, distinct from Escape above.
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
    });

    expect(settled).toBeNull();
    expect(document.querySelector("[role=dialog]")).not.toBeNull();
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

// Every dialog here opens from code, with no Radix trigger to return to, so the
// modal itself must hand focus back: a task list that asked to delete a task
// keeps answering arrows once the confirmation closes.
describe("focus on close", () => {
  it("returns focus to what held it when the dialog opened", async () => {
    const list = document.createElement("div");
    list.tabIndex = 0;
    document.body.appendChild(list);
    list.focus();
    let answer!: Promise<boolean>;
    await open(() => { answer = showAppConfirm(message("dialog.deleteTask.title"), message("dialog.deleteNote.body"), { confirmLabel: message("dialog.delete") }); });
    expect(document.activeElement).not.toBe(list);
    await answerCurrent("confirm");
    await expect(answer).resolves.toBe(true);
    // Radix settles close focus on a timer after unmount.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(document.activeElement).toBe(list);
    list.remove();
  });
});

// With the window minimized or hidden, a question goes to a standalone dialog
// instead of waiting unseen in that window (window-conventions, Background
// visibility): Dock › Quit with the window minimized still asks.
describe("a question asked while the window is not showing", () => {
  afterEach(() => {
    shown.showing = true;
    shown.answer = null;
    shown.asked = [];
  });

  it("asks through a standalone dialog, safe choice first, and takes its answer", async () => {
    shown.showing = false;
    shown.answer = "Quit Anyway";
    let choice!: Promise<"quit" | "retry" | "cancel">;
    await open(() => { choice = useDialogStore.getState().enqueueQuitSave(["tasks.json"]); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(shown.asked).toEqual([["Cancel", "Retry", "Quit Anyway"]]);
    await expect(choice).resolves.toBe("quit");
  });

  it("treats a standalone dialog closed without a choice as the safe answer", async () => {
    shown.showing = false;
    shown.answer = null;
    let answer!: Promise<boolean>;
    await open(() => { answer = showAppConfirm(message("dialog.deleteTask.title"), message("dialog.deleteNote.body"), { confirmLabel: message("dialog.delete") }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(shown.asked[0]).toEqual(["Cancel", "Delete"]);
    await expect(answer).resolves.toBe(false);
  });

  it("stays in the window while it is showing", async () => {
    await open(() => void showAppMessage(message("dialog.deleteTask.title"), message("dialog.deleteNote.body")));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(shown.asked).toEqual([]);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
