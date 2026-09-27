import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyWindowActivity } from "../../src/repositories/window-activity";

describe("window activity", () => {
  it("marks the root inactive and clears it when the window is focused again", () => {
    const calls: Array<[string, boolean | undefined]> = [];
    const root = { toggleAttribute: (name: string, force?: boolean) => { calls.push([name, force]); return !!force; } };
    applyWindowActivity(root, false);
    applyWindowActivity(root, true);
    expect(calls).toEqual([["data-window-inactive", true], ["data-window-inactive", false]]);
  });

  it("quiets the focus ring token while inactive", () => {
    const css = readFileSync(join(__dirname, "..", "..", "src/App.css"), "utf8");
    expect(css).toMatch(/:root\[data-window-inactive\]\s*\{\s*--primary-ring:\s*var\(--input-border\);/);
  });
});
