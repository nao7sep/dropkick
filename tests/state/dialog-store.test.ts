import { describe, it, expect, beforeEach } from "vitest";
import { useDialogStore, showAppMessage, showAppConfirm } from "../../src/state/dialog-store";

// dialog-store is pure zustand (no Tauri). It models a single visible dialog
// plus a FIFO queue, and resolves the awaiting promise when the user
// confirms/cancels.

beforeEach(() => {
  useDialogStore.setState({ current: null, queue: [] });
});

describe("enqueue + confirm/cancel", () => {
  it("shows the first request immediately as `current`", () => {
    void useDialogStore.getState().enqueueMessage("Title", "Body");
    const { current } = useDialogStore.getState();
    expect(current?.kind).toBe("message");
    expect(current?.title).toBe("Title");
  });

  it("resolves an awaited message when confirmed", async () => {
    const promise = showAppMessage("T", "B");
    useDialogStore.getState().confirmCurrent();
    await expect(promise).resolves.toBeUndefined();
    expect(useDialogStore.getState().current).toBeNull();
  });

  it("resolves a confirm with true on confirm and false on cancel", async () => {
    const confirmed = showAppConfirm("T", "B");
    useDialogStore.getState().confirmCurrent();
    await expect(confirmed).resolves.toBe(true);

    const cancelled = showAppConfirm("T2", "B2");
    useDialogStore.getState().cancelCurrent();
    await expect(cancelled).resolves.toBe(false);
  });

  it("applies default labels and tone", () => {
    void useDialogStore.getState().enqueueConfirm("T", "B");
    const current = useDialogStore.getState().current;
    expect(current).toMatchObject({
      tone: "default",
      confirmLabel: "OK",
      cancelLabel: "Cancel",
    });
  });

  it("honors custom options", () => {
    void useDialogStore.getState().enqueueMessage("T", "B", {
      tone: "warning",
      confirmLabel: "Got it",
    });
    expect(useDialogStore.getState().current).toMatchObject({
      tone: "warning",
      confirmLabel: "Got it",
    });
  });
});

describe("queueing", () => {
  it("queues subsequent requests behind the current one in FIFO order", () => {
    void useDialogStore.getState().enqueueMessage("first", "B");
    void useDialogStore.getState().enqueueMessage("second", "B");
    void useDialogStore.getState().enqueueMessage("third", "B");

    const state = useDialogStore.getState();
    expect(state.current?.title).toBe("first");
    expect(state.queue.map((q) => q.title)).toEqual(["second", "third"]);
  });

  it("advances to the next queued dialog after resolving the current one", () => {
    const p1 = showAppMessage("first", "B");
    void showAppMessage("second", "B");

    useDialogStore.getState().confirmCurrent();
    expect(useDialogStore.getState().current?.title).toBe("second");
    return p1; // ensure the first promise settles
  });

  it("resolves each queued promise as it is reached", async () => {
    const order: string[] = [];
    const p1 = showAppConfirm("first", "B").then((v) => order.push(`first:${v}`));
    const p2 = showAppConfirm("second", "B").then((v) => order.push(`second:${v}`));

    useDialogStore.getState().confirmCurrent(); // first -> true
    useDialogStore.getState().cancelCurrent(); // second -> false

    await Promise.all([p1, p2]);
    expect(order).toEqual(["first:true", "second:false"]);
  });

  it("ignores confirm/cancel when there is no current dialog", () => {
    expect(() => useDialogStore.getState().confirmCurrent()).not.toThrow();
    expect(() => useDialogStore.getState().cancelCurrent()).not.toThrow();
    expect(useDialogStore.getState().current).toBeNull();
  });
});
