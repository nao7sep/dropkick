import { create } from "zustand";

type DialogTone = "default" | "warning";

interface DialogOptions {
  tone?: DialogTone;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface MessageDialogRequest {
  kind: "message";
  title: string;
  body: string;
  tone: DialogTone;
  confirmLabel: string;
  resolve: () => void;
}

interface ConfirmDialogRequest {
  kind: "confirm";
  title: string;
  body: string;
  tone: DialogTone;
  confirmLabel: string;
  cancelLabel: string;
  resolve: (confirmed: boolean) => void;
}

export type DialogRequest = MessageDialogRequest | ConfirmDialogRequest;

interface DialogState {
  current: DialogRequest | null;
  queue: DialogRequest[];
  enqueueMessage: (
    title: string,
    body: string,
    options?: DialogOptions,
  ) => Promise<void>;
  enqueueConfirm: (
    title: string,
    body: string,
    options?: DialogOptions,
  ) => Promise<boolean>;
  confirmCurrent: () => void;
  cancelCurrent: () => void;
}

function advanceQueue(queue: DialogRequest[]) {
  const [next, ...rest] = queue;
  return { current: next ?? null, queue: rest };
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
        confirmLabel: options.confirmLabel ?? "OK",
        resolve,
      };

      const { current, queue } = get();
      if (current) {
        set({ queue: [...queue, request] });
      } else {
        set({ current: request });
      }
    }),

  enqueueConfirm: async (title, body, options = {}) =>
    await new Promise<boolean>((resolve) => {
      const request: ConfirmDialogRequest = {
        kind: "confirm",
        title,
        body,
        tone: options.tone ?? "default",
        confirmLabel: options.confirmLabel ?? "OK",
        cancelLabel: options.cancelLabel ?? "Cancel",
        resolve,
      };

      const { current, queue } = get();
      if (current) {
        set({ queue: [...queue, request] });
      } else {
        set({ current: request });
      }
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
  title: string,
  body: string,
  options?: DialogOptions,
): Promise<void> {
  return await useDialogStore.getState().enqueueMessage(title, body, options);
}

export async function showAppConfirm(
  title: string,
  body: string,
  options?: DialogOptions,
): Promise<boolean> {
  return await useDialogStore.getState().enqueueConfirm(title, body, options);
}
