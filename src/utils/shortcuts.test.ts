import { describe, it, expect, afterEach, vi } from "vitest";
import { matchesShortcutKey } from "./shortcuts";
import { importWithPlatform } from "../../test/helpers/platform";

type ShortcutsModule = typeof import("./shortcuts");

describe("matchesShortcutKey", () => {
  it("matches single-character keys case-insensitively", () => {
    expect(matchesShortcutKey({ key: "P" }, "p")).toBe(true);
    expect(matchesShortcutKey({ key: "p" }, "P")).toBe(true);
  });

  it("matches multi-character keys exactly (case-sensitive)", () => {
    expect(matchesShortcutKey({ key: "Enter" }, "Enter")).toBe(true);
    expect(matchesShortcutKey({ key: "enter" }, "Enter")).toBe(false);
  });

  it("does not match different keys", () => {
    expect(matchesShortcutKey({ key: "x" }, "c")).toBe(false);
  });
});

describe("hasPrimaryShortcutModifier (platform-dependent)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses metaKey (Cmd) on macOS", async () => {
    const { hasPrimaryShortcutModifier } = await importWithPlatform<ShortcutsModule>("mac", () => import("./shortcuts"));
    expect(hasPrimaryShortcutModifier({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(hasPrimaryShortcutModifier({ metaKey: false, ctrlKey: true })).toBe(false);
  });

  it("uses ctrlKey on Windows", async () => {
    const { hasPrimaryShortcutModifier } = await importWithPlatform<ShortcutsModule>("windows", () => import("./shortcuts"));
    expect(hasPrimaryShortcutModifier({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(hasPrimaryShortcutModifier({ metaKey: true, ctrlKey: false })).toBe(false);
  });
});
