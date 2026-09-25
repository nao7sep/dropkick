import { message } from "../../src/i18n/translate";
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
    void useDialogStore.getState().enqueueMessage(message("dialog.deleteTask.title"), message("dialog.deleteNote.body"));
    const { current } = useDialogStore.getState();
    expect(current?.kind).toBe("message");
    expect(current?.title).toEqual(message("dialog.deleteTask.title"));
  });

  it("resolves an awaited message when confirmed", async () => {
    const promise = showAppMessage(message("dialog.deleteTask.title"), message("dialog.deleteNote.body"));
    useDialogStore.getState().confirmCurrent();
    await expect(promise).resolves.toBeUndefined();
    expect(useDialogStore.getState().current).toBeNull();
  });

  it("resolves a confirm with true on confirm and false on cancel", async () => {
    const confirmed = showAppConfirm(message("dialog.deleteTask.title"), message("dialog.deleteNote.body"));
    useDialogStore.getState().confirmCurrent();
    await expect(confirmed).resolves.toBe(true);

    const cancelled = showAppConfirm(message("dialog.deleteNote.title"), message("dialog.deleteTask.body"));
    useDialogStore.getState().cancelCurrent();
    await expect(cancelled).resolves.toBe(false);
  });

  it("applies default labels and tone", () => {
    void useDialogStore.getState().enqueueConfirm(message("dialog.deleteTask.title"), message("dialog.deleteNote.body"));
    const current = useDialogStore.getState().current;
    expect(current).toMatchObject({
      tone: "default",
      confirmLabel: message("common.ok"),
      cancelLabel: message("common.cancel"),
    });
  });

  it("honors custom options", () => {
    void useDialogStore.getState().enqueueMessage(message("dialog.deleteTask.title"), message("dialog.deleteNote.body"), {
      tone: "warning",
      confirmLabel: message("dialog.delete"),
    });
    expect(useDialogStore.getState().current).toMatchObject({
      tone: "warning",
      confirmLabel: message("dialog.delete"),
    });
  });
});

describe("queueing", () => {
  it("queues subsequent requests behind the current one in FIFO order", () => {
    void useDialogStore.getState().enqueueMessage(message("startup.appStateReset.title"), message("dialog.deleteNote.body"));
    void useDialogStore.getState().enqueueMessage(message("dialog.deleteTask.title"), message("dialog.deleteNote.body"));
    void useDialogStore.getState().enqueueMessage(message("dialog.fileConflict.title"), message("dialog.deleteNote.body"));

    const state = useDialogStore.getState();
    expect(state.current?.title).toEqual(message("startup.appStateReset.title"));
    expect(state.queue.map((q) => q.title)).toEqual([
      message("dialog.deleteTask.title"),
      message("dialog.fileConflict.title"),
    ]);
  });

  it("advances to the next queued dialog after resolving the current one", () => {
    const p1 = showAppMessage(message("startup.appStateReset.title"), message("dialog.deleteNote.body"));
    void showAppMessage(message("dialog.deleteTask.title"), message("dialog.deleteNote.body"));

    useDialogStore.getState().confirmCurrent();
    expect(useDialogStore.getState().current?.title).toEqual(message("dialog.deleteTask.title"));
    return p1; // ensure the first promise settles
  });

  it("resolves each queued promise as it is reached", async () => {
    const order: string[] = [];
    const p1 = showAppConfirm(message("startup.appStateReset.title"), message("dialog.deleteNote.body")).then((v) => order.push(`first:${v}`));
    const p2 = showAppConfirm(message("dialog.deleteTask.title"), message("dialog.deleteNote.body")).then((v) => order.push(`second:${v}`));

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

describe("withdrawal", () => {
  const title = message("dialog.deleteTask.title");
  const body = message("dialog.deleteNote.body");

  it("takes the showing dialog off screen and settles it as cancelled", async () => {
    const withdraw = new AbortController();
    const queued = showAppConfirm(message("startup.appStateReset.title"), body);
    useDialogStore.getState().confirmCurrent();
    await queued;

    const answer = showAppConfirm(title, body, { signal: withdraw.signal });
    const next = showAppConfirm(message("startup.appStateReset.title"), body);
    expect(useDialogStore.getState().current?.title).toEqual(title);

    withdraw.abort();

    await expect(answer).resolves.toBe(false);
    expect(useDialogStore.getState().current?.title).toEqual(
      message("startup.appStateReset.title"),
    );
    useDialogStore.getState().cancelCurrent();
    await next;
  });

  it("removes a queued dialog before it is ever shown", async () => {
    const withdraw = new AbortController();
    const first = showAppConfirm(message("startup.appStateReset.title"), body);
    const answer = showAppConfirm(title, body, { signal: withdraw.signal });

    withdraw.abort();

    await expect(answer).resolves.toBe(false);
    expect(useDialogStore.getState().queue).toEqual([]);
    useDialogStore.getState().confirmCurrent();
    await expect(first).resolves.toBe(true);
    expect(useDialogStore.getState().current).toBeNull();
  });

  it("leaves an answered dialog's result alone", async () => {
    const withdraw = new AbortController();
    const answer = showAppConfirm(title, body, { signal: withdraw.signal });
    useDialogStore.getState().confirmCurrent();
    withdraw.abort();
    await expect(answer).resolves.toBe(true);
  });
});
