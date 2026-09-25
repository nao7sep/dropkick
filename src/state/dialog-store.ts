import { create } from "zustand";
import { message, type Message } from "../i18n/translate";

type DialogTone = "default" | "warning" | "danger";

interface DialogOptions {
  tone?: DialogTone;
  confirmLabel?: Message;
  cancelLabel?: Message;
  // Set when BOTH choices destroy something different, so neither is the safe
  // one. Such a dialog opens with focus on its own surface instead of on a
  // button, so a reflexive Enter does nothing and the user must pick
  // deliberately (modal-dialog-conventions). Do not set it to avoid choosing:
  // it states that no safe choice exists, not that one was hard to pick.
  noSafeAction?: boolean;
  // Withdraws the request when aborted: it leaves the screen (or the queue) and
  // settles through its cancel path. For a question the app stops needing an
  // answer to, such as "close anyway?" once the pending writes have finished.
  signal?: AbortSignal;
}

// Dialog text is a key plus values, rendered by AppDialogHost in the current
// language.
interface MessageDialogRequest {
  kind: "message";
  title: Message;
  body: Message;
  tone: DialogTone;
  confirmLabel: Message;
  resolve: () => void;
}

interface ConfirmDialogRequest {
  kind: "confirm";
  title: Message;
  body: Message;
  tone: DialogTone;
  confirmLabel: Message;
  cancelLabel: Message;
  noSafeAction: boolean;
  resolve: (confirmed: boolean) => void;
}

export type DialogRequest = MessageDialogRequest | ConfirmDialogRequest;

interface DialogState {
  current: DialogRequest | null;
  queue: DialogRequest[];
  enqueueMessage: (
    title: Message,
    body: Message,
    options?: DialogOptions,
  ) => Promise<void>;
  enqueueConfirm: (
    title: Message,
    body: Message,
    options?: DialogOptions,
  ) => Promise<boolean>;
  confirmCurrent: () => void;
  cancelCurrent: () => void;
}

function advanceQueue(queue: DialogRequest[]) {
  const [next, ...rest] = queue;
  return { current: next ?? null, queue: rest };
}

type SetDialogState = (
  partial: Partial<Pick<DialogState, "current" | "queue">>,
) => void;

// Shows the request now, or queues it behind the one on screen, and wires its
// withdrawal to `signal`.
function present(
  request: DialogRequest,
  signal: AbortSignal | undefined,
  get: () => DialogState,
  set: SetDialogState,
  settleCancelled: () => void,
): void {
  if (signal?.aborted) {
    settleCancelled();
    return;
  }
  const { current, queue } = get();
  if (current) {
    set({ queue: [...queue, request] });
  } else {
    set({ current: request });
  }
  signal?.addEventListener(
    "abort",
    () => {
      const state = get();
      if (state.current === request) {
        set(advanceQueue(state.queue));
      } else if (state.queue.includes(request)) {
        set({ queue: state.queue.filter((queued) => queued !== request) });
      } else {
        return; // already answered
      }
      settleCancelled();
    },
    { once: true },
  );
}

export const useDialogStore = create<DialogState>((set, get) => ({
  current: null,
  queue: [],

  enqueueMessage: async (title, body, options = {}) =>
    await new Promise<void>((resolve) => {
      const request: MessageDialogRequest = {
        kind: "message",
        title,
        body,
        tone: options.tone ?? "default",
        confirmLabel: options.confirmLabel ?? message("common.ok"),
        resolve,
      };
      present(request, options.signal, get, set, () => resolve());
    }),

  enqueueConfirm: async (title, body, options = {}) =>
    await new Promise<boolean>((resolve) => {
      const request: ConfirmDialogRequest = {
        kind: "confirm",
        title,
        body,
        tone: options.tone ?? "default",
        confirmLabel: options.confirmLabel ?? message("common.ok"),
        cancelLabel: options.cancelLabel ?? message("common.cancel"),
        noSafeAction: options.noSafeAction ?? false,
        resolve,
      };
      present(request, options.signal, get, set, () => resolve(false));
    }),

  confirmCurrent: () => {
    const { current, queue } = get();
    if (!current) return;

    set(advanceQueue(queue));

    if (current.kind === "message") {
      current.resolve();
    } else {
      current.resolve(true);
    }
  },

  cancelCurrent: () => {
    const { current, queue } = get();
    if (!current) return;

    set(advanceQueue(queue));

    if (current.kind === "message") {
      current.resolve();
    } else {
      current.resolve(false);
    }
  },
}));

export async function showAppMessage(
  title: Message,
  body: Message,
  options?: DialogOptions,
): Promise<void> {
  return await useDialogStore.getState().enqueueMessage(title, body, options);
}

export async function showAppConfirm(
  title: Message,
  body: Message,
  options?: DialogOptions,
): Promise<boolean> {
  return await useDialogStore.getState().enqueueConfirm(title, body, options);
}
