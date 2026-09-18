import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { contrast, resolveRgb, themeBlock } from "../helpers/theme-css";

// Read the shipped stylesheet as text and assert the app-chrome scroll-bar
// rules are present. A render-free check: it guards that the global scroll-bar
// styling and the per-theme color-scheme declarations survive future edits to
// App.css. (The exact colors are theme tokens, so we assert structure, not hex.)
const css = readFileSync(
  fileURLToPath(new URL("../../src/App.css", import.meta.url)),
  "utf8",
);

// Strip whitespace so assertions don't depend on formatting (line breaks,
// indentation) between a property and its value.
const compact = css.replace(/\s+/g, "");
const tailwindTheme = readFileSync(
  fileURLToPath(new URL("../../node_modules/tailwindcss/theme.css", import.meta.url)),
  "utf8",
);

describe("App.css scroll-bar styling (app-chrome-conventions)", () => {
  it("styles the WebKit scroll-bar pseudo-element globally", () => {
    expect(css).toMatch(/::-webkit-scrollbar\b/);
    expect(css).toMatch(/::-webkit-scrollbar-thumb\b/);
  });

  it("keeps the standards path at a normal, acquirable width", () => {
    expect(compact).toContain("scrollbar-width:auto");
    expect(compact).not.toContain("scrollbar-width:thin");
  });

  it("declares scrollbar-color so the bar is themed", () => {
    expect(css).toMatch(/scrollbar-color\s*:/);
  });

  it("makes the thumb a rounded pill", () => {
    expect(compact).toMatch(/::-webkit-scrollbar-thumb\{[^}]*border-radius:/);
  });

  it("keeps a 16px hit gutter and a 10px visible thumb", () => {
    const bar = compact.match(/::-webkit-scrollbar\{[^}]*\}/)?.[0] ?? "";
    const thumb = compact.match(/::-webkit-scrollbar-thumb\{[^}]*\}/)?.[0] ?? "";
    expect(bar).toContain("width:16px");
    expect(bar).toContain("height:16px");
    expect(thumb).toContain("border:3pxsolidtransparent");
    expect(thumb).toContain("background-clip:padding-box");
  });

  it("keeps the track transparent", () => {
    expect(compact).toMatch(/::-webkit-scrollbar-track\{[^}]*background:transparent/);
  });

  it("brightens the thumb while its whole owner is hovered or contains focus", () => {
    expect(css).toMatch(/::-webkit-scrollbar-thumb:hover\b/);
    expect(compact).toContain("*:hover::-webkit-scrollbar-thumb");
    expect(compact).toContain("*:focus-within::-webkit-scrollbar-thumb");
    expect(compact).toContain("*:hover,*:focus-within");
    expect(compact).toContain("scrollbar-color:var(--scrollbar-thumb-hover)transparent");
  });

  it("keeps the resting thumb at least 3:1 against every base surface in both themes", () => {
    const surfaceTokens = ["--background", "--surface", "--surface-muted", "--surface-sunken"];
    const sources = `${css}\n${tailwindTheme}`;
    for (const theme of ["light", "dark"] as const) {
      const block = themeBlock(css, theme);
      const thumb = resolveRgb(block, "--scrollbar-thumb", sources);
      for (const surfaceToken of surfaceTokens) {
        expect(
          contrast(thumb, resolveRgb(block, surfaceToken, sources)),
          `${theme} ${surfaceToken}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("reserves a stable gutter and visible focus treatment for passive owners", () => {
    expect(compact).toMatch(/\[data-passive-scroll-region\]\{[^}]*scrollbar-gutter:stable/);
    expect(compact).toMatch(/\[data-passive-scroll-region\]:focus-visible\{[^}]*outline:/);
  });

  it("retains both color-scheme declarations (light and dark)", () => {
    expect(compact).toContain("color-scheme:light");
    expect(compact).toContain("color-scheme:dark");
  });
});
