import { describe, it, expect, beforeEach } from "vitest";
import { useToastStore } from "../../src/state/toast-store";

// toast-store is pure zustand: transient no-op feedback and the persistent
// background-write result are independent channels.

beforeEach(() => {
  useToastStore.setState({ message: null, token: 0, backgroundWriteError: null });
});

describe("background-write error", () => {
  it("survives unrelated transient feedback", () => {
    useToastStore
      .getState()
      .showBackgroundWriteError("Window layout", "Window layout could not be saved.");
    useToastStore.getState().showToast("This action is unavailable here.");

    expect(useToastStore.getState().backgroundWriteError).toEqual({
      what: "Window layout",
      message: "Window layout could not be saved.",
    });
    expect(useToastStore.getState().message).toBe(
      "This action is unavailable here.",
    );
  });

  it("is resolved only by a matching successful write or explicit dismissal", () => {
    const store = useToastStore.getState();
    store.showBackgroundWriteError("Window layout", "Failed");
    store.clearBackgroundWriteError("Saved locations");
    expect(useToastStore.getState().backgroundWriteError).not.toBeNull();

    store.clearBackgroundWriteError("Window layout");
    expect(useToastStore.getState().backgroundWriteError).toBeNull();
  });
});

describe("showToast", () => {
  it("sets the message and bumps the token", () => {
    useToastStore.getState().showToast("hello");
    const { message, token } = useToastStore.getState();
    expect(message).toBe("hello");
    expect(token).toBe(1);
  });

  it("bumps the token even when the same message repeats", () => {
    useToastStore.getState().showToast("same");
    useToastStore.getState().showToast("same");
    const { message, token } = useToastStore.getState();
    expect(message).toBe("same");
    expect(token).toBe(2);
  });

  it("replaces an existing message", () => {
    useToastStore.getState().showToast("first");
    useToastStore.getState().showToast("second");
    expect(useToastStore.getState().message).toBe("second");
    expect(useToastStore.getState().token).toBe(2);
  });
});

describe("clearToast", () => {
  it("clears the message when the token still matches", () => {
    useToastStore.getState().showToast("bye");
    const { token } = useToastStore.getState();
    useToastStore.getState().clearToast(token);
    expect(useToastStore.getState().message).toBeNull();
  });

  it("ignores a stale token so a newer toast survives", () => {
    useToastStore.getState().showToast("old");
    const staleToken = useToastStore.getState().token;
    useToastStore.getState().showToast("new");

    // A dismiss timer scheduled for the old toast fires after the new one.
    useToastStore.getState().clearToast(staleToken);

    expect(useToastStore.getState().message).toBe("new");
  });
});
