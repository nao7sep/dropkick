import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Read the shipped stylesheet as text and assert the window-chrome scroll-bar
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

describe("App.css scroll-bar styling (window-chrome-conventions)", () => {
  it("styles the WebKit scroll-bar pseudo-element globally", () => {
    expect(css).toMatch(/::-webkit-scrollbar\b/);
    expect(css).toMatch(/::-webkit-scrollbar-thumb\b/);
  });

  it("declares scrollbar-width: thin for the standards path", () => {
    expect(compact).toContain("scrollbar-width:thin");
  });

  it("declares scrollbar-color so the thin bar is themed", () => {
    expect(css).toMatch(/scrollbar-color\s*:/);
  });

  it("makes the thumb a rounded pill", () => {
    expect(compact).toMatch(/::-webkit-scrollbar-thumb\{[^}]*border-radius:/);
  });

  it("insets the thumb via a transparent border clipped to the padding box", () => {
    const thumb = compact.match(/::-webkit-scrollbar-thumb\{[^}]*\}/)?.[0] ?? "";
    expect(thumb).toContain("border:3pxsolidtransparent");
    expect(thumb).toContain("background-clip:padding-box");
  });

  it("keeps the track transparent", () => {
    expect(compact).toMatch(/::-webkit-scrollbar-track\{[^}]*background:transparent/);
  });

  it("brightens the thumb on hover", () => {
    expect(css).toMatch(/::-webkit-scrollbar-thumb:hover\b/);
  });

  it("retains both color-scheme declarations (light and dark)", () => {
    expect(compact).toContain("color-scheme:light");
    expect(compact).toContain("color-scheme:dark");
  });
});
