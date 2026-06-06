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
}

export const useToastStore = create<ToastState>((set, get) => ({
  message: null,
  token: 0,
  showToast: (message) => set((s) => ({ message, token: s.token + 1 })),
  // Only clear if no newer toast has replaced this one.
  clearToast: (token) => {
    if (get().token === token) set({ message: null });
  },
}));
