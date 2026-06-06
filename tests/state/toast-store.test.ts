import { describe, it, expect, beforeEach } from "vitest";
import { useToastStore } from "../../src/state/toast-store";

// toast-store is pure zustand: it holds the single visible toast message plus a
// monotonic token. The token lets the host restart its dismiss timer/animation
// on a repeat message, and lets a stale dismiss timer no-op after a newer toast.

beforeEach(() => {
  useToastStore.setState({ message: null, token: 0 });
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
