import { describe, it, expect, beforeEach } from "vitest";
import { useToastStore } from "../../src/state/toast-store";
import { message } from "../../src/i18n/translate";

// toast-store is pure zustand: transient no-op feedback and the persistent
// background-write result are independent channels.

beforeEach(() => {
  useToastStore.setState({ message: null, token: 0, backgroundWriteError: null });
});

describe("background-write error", () => {
  it("survives unrelated transient feedback", () => {
    useToastStore
      .getState()
      .showBackgroundWriteError("viewSettings", message("write.viewSettings"));
    useToastStore.getState().showToast(message("toast.unifiedReorder"));

    expect(useToastStore.getState().backgroundWriteError).toEqual({
      what: "viewSettings",
      message: message("write.viewSettings"),
    });
    expect(useToastStore.getState().message).toEqual(message("toast.unifiedReorder"));
  });

  it("is resolved only by a matching successful write or explicit dismissal", () => {
    const store = useToastStore.getState();
    store.showBackgroundWriteError("viewSettings", message("write.viewSettings"));
    store.clearBackgroundWriteError("savedLocations");
    expect(useToastStore.getState().backgroundWriteError).not.toBeNull();

    store.clearBackgroundWriteError("viewSettings");
    expect(useToastStore.getState().backgroundWriteError).toBeNull();
  });
});

describe("showToast", () => {
  it("sets the message and bumps the token", () => {
    useToastStore.getState().showToast(message("toast.unifiedDropkick"));
    const { message: shown, token } = useToastStore.getState();
    expect(shown).toEqual(message("toast.unifiedDropkick"));
    expect(token).toBe(1);
  });

  it("bumps the token even when the same message repeats", () => {
    useToastStore.getState().showToast(message("toast.unifiedDropkick"));
    useToastStore.getState().showToast(message("toast.unifiedDropkick"));
    const { message: shown, token } = useToastStore.getState();
    expect(shown).toEqual(message("toast.unifiedDropkick"));
    expect(token).toBe(2);
  });

  it("replaces an existing message", () => {
    useToastStore.getState().showToast(message("toast.unifiedDropkick"));
    useToastStore.getState().showToast(message("toast.unifiedReorder"));
    expect(useToastStore.getState().message).toEqual(message("toast.unifiedReorder"));
    expect(useToastStore.getState().token).toBe(2);
  });
});

describe("clearToast", () => {
  it("clears the message when the token still matches", () => {
    useToastStore.getState().showToast(message("toast.unifiedDropkick"));
    const { token } = useToastStore.getState();
    useToastStore.getState().clearToast(token);
    expect(useToastStore.getState().message).toBeNull();
  });

  it("ignores a stale token so a newer toast survives", () => {
    useToastStore.getState().showToast(message("toast.unifiedDropkick"));
    const staleToken = useToastStore.getState().token;
    useToastStore.getState().showToast(message("toast.unifiedReorder"));

    // A dismiss timer scheduled for the old toast fires after the new one.
    useToastStore.getState().clearToast(staleToken);

    expect(useToastStore.getState().message).toEqual(message("toast.unifiedReorder"));
  });
});
