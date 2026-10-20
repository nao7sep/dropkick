import { describe, it, expect } from "vitest";
import postcss from "postcss";
import { appCss, declarationValue, isUnconditioned, rulesFor } from "../helpers/css-tree";

// The UI font has to be a :root token, not a style on the main window's own
// subtree. Every Radix surface - modals, menus, popovers, the date picker - and
// the toast host render OUTSIDE that subtree (they portal to <body>), so a
// subtree style reaches the main window and nothing else, and the user's chosen
// font silently stops at the first dialog. This is a render-free check on the
// stylesheet, mirroring the scroll-bar guard.
const css = appCss();
const roots = rulesFor(css, ":root").filter(isUnconditioned);

describe("UI font (App.css)", () => {
  it("declares --font-ui on :root and uses it for the page font", () => {
    expect(roots.some((rule) => declarationValue(rule, "--font-ui") !== undefined)).toBe(true);
    expect(roots.some((rule) => declarationValue(rule, "font-family") === "var(--font-ui)")).toBe(true);
    expect(rulesFor(css, "body").some((rule) => declarationValue(rule, "font-size") === "13px")).toBe(true);
  });

  it("falls back to a real sans stack, never the engine default", () => {
    // An unknown family the user typed is appended to this, so the fallback is
    // what they land on.
    const stack = roots.map((rule) => declarationValue(rule, "--font-ui")).find((value) => value !== undefined);
    expect(postcss.list.comma(stack ?? "").at(-1)).toBe("sans-serif");
  });
});
