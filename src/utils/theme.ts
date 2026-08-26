import type { ThemePreference } from "../models";

export const SYSTEM_DARK_THEME_QUERY = "(prefers-color-scheme: dark)";

export function resolveDarkMode(
  theme: ThemePreference,
  systemDarkMode: boolean,
): boolean {
  return theme === "dark" || (theme === "system" && systemDarkMode);
}

// The existing shortcut remains a quick binary appearance switch. From System
// it chooses the opposite of the OS's current appearance; Settings is where the
// user returns to following the system.
export function toggledThemePreference(
  theme: ThemePreference,
  systemDarkMode: boolean,
): ThemePreference {
  return resolveDarkMode(theme, systemDarkMode) ? "light" : "dark";
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(SYSTEM_DARK_THEME_QUERY).matches
  );
}
