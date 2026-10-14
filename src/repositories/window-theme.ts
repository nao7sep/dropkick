// The native window theme is the one theme authority (app-chrome conventions,
// Theme): the Rust core maps the preference to the window theme and sets the
// matching window background in one step (src-tauri/src/theme.rs). The page
// follows through prefers-color-scheme and never resolves System itself.

import { invoke } from "@tauri-apps/api/core";
import type { ThemePreference } from "../models";

export async function applyWindowTheme(preference: ThemePreference): Promise<void> {
  await invoke<void>("apply_theme", { preference });
}

// What System resolves to right now, read from the OS setting by the core,
// since the window's own theme follows a Light or Dark choice; null where the
// platform has none or the read fails.
export async function readSystemTheme(): Promise<"light" | "dark" | null> {
  try {
    return (await invoke<"light" | "dark" | null>("system_theme")) ?? null;
  } catch {
    return null;
  }
}
