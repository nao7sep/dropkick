import { create } from "zustand";

// Transient, auto-dismissing toast for non-obvious no-ops — e.g. pressing
// Dropkick or a reorder key while in unified view, where the action can't run
// and the user may not realize which view they're in. Selection mistakes are
// visible on screen, so they deliberately do not toast.
interface ToastState {
  message: string | null;
  // Bumped on every showToast so the host can restart its dismiss timer and
  // replay the animation even when the same message is shown twice in a row.
  token: number;
  showToast: (message: string) => void;
  clearToast: (token: number) => void;
  backgroundWriteError: { what: string; message: string } | null;
  showBackgroundWriteError: (what: string, message: string) => void;
  clearBackgroundWriteError: (what?: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  message: null,
  token: 0,
  backgroundWriteError: null,
  showToast: (message) => set((s) => ({ message, token: s.token + 1 })),
  // Only clear if no newer toast has replaced this one.
  clearToast: (token) => {
    if (get().token === token) set({ message: null });
  },
  showBackgroundWriteError: (what, message) => {
    set({ backgroundWriteError: { what, message } });
  },
  // A successful retry resolves only its own failure. Dismissal omits `what`
  // and clears the currently visible result explicitly.
  clearBackgroundWriteError: (what) => {
    const current = get().backgroundWriteError;
    if (current !== null && (what === undefined || current.what === what)) {
      set({ backgroundWriteError: null });
    }
  },
}));
