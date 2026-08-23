import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The UI font has to be a :root token, not a style on the main window's own
// subtree. Every Radix surface - modals, menus, popovers, the date picker - and
// the toast host render OUTSIDE that subtree (they portal to <body>), so a
// subtree style reaches the main window and nothing else, and the user's chosen
// font silently stops at the first dialog. This is a render-free check on the
// stylesheet and the component, mirroring the scroll-bar guard.
const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n?/g, "\n");

const css = read("../../src/App.css");
const mainWindow = read("../../src/components/layout/MainWindow.tsx");

describe("UI font (App.css + MainWindow)", () => {
  it("declares --font-ui on :root and uses it for the page font", () => {
    const root = css.slice(css.indexOf(":root {\n  /*"));
    expect(root).toContain("--font-ui:");
    expect(root).toContain("font-family: var(--font-ui)");
  });

  it("falls back to a real sans stack, never the engine default", () => {
    // An unknown family the user typed is appended to this, so the fallback is
    // what they land on.
    expect(css).toContain("sans-serif");
    expect(css).not.toMatch(/--font-ui:\s*system-ui;/);
  });

  it("does not pin the font inside the main window's subtree", () => {
    expect(mainWindow).not.toContain("fontFamily");
  });
});
