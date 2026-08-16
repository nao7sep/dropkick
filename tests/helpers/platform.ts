// Helpers for testing platform-dependent modules.
//
// utils/shortcuts reads navigator.platform once at module load for the
// primary-modifier DISPLAY word and the macOS shadow predicate (the binding
// itself accepts both modifiers on every platform). To test both platforms,
// stub navigator BEFORE importing the module and re-import it with a fresh
// module registry each time.

import { vi } from "vitest";

export type TestPlatform = "mac" | "windows";

const PLATFORM_STRINGS: Record<TestPlatform, string> = {
  mac: "MacIntel",
  windows: "Win32",
};

// Stubs navigator.platform, resets the module cache, then runs the given loader
// so the module's load-time platform detection sees the stubbed value. The
// loader must contain the dynamic import() itself (e.g. () => import("../../src/utils/zoom"))
// so the specifier resolves relative to the calling test file.
export async function importWithPlatform<T>(
  platform: TestPlatform,
  loader: () => Promise<T>,
): Promise<T> {
  vi.stubGlobal("navigator", {
    platform: PLATFORM_STRINGS[platform],
    userAgent: PLATFORM_STRINGS[platform],
  });
  vi.resetModules();
  return loader();
}
