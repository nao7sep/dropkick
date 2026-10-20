import { describe, it, expect } from "vitest";
import {
  appCss,
  atRulesAround,
  declarationValue,
  isUnconditioned,
  rulesFor,
  rulesOf,
  rulesWithSelectors,
  selectorsOf,
} from "../helpers/css-tree";
import { contrast, resolveRgb, themeTokens, tokenSources } from "../helpers/theme-css";

// Read the shipped stylesheet's syntax tree and assert the app-chrome
// scroll-bar rules are present. A render-free check: it guards that the global
// scroll-bar styling and the per-theme color-scheme declarations survive future
// edits to App.css. (The exact colors are theme tokens, so we assert structure,
// not hex.)
const css = appCss();

// The value every unconditioned rule for `selector` gives `property`.
function globalValues(selector: string, property: string): string[] {
  return rulesFor(css, selector)
    .filter(isUnconditioned)
    .map((rule) => declarationValue(rule, property))
    .filter((value): value is string => value !== undefined);
}

describe("App.css scroll-bar styling (app-chrome-conventions)", () => {
  it("styles the WebKit scroll-bar pseudo-element globally", () => {
    expect(rulesFor(css, "::-webkit-scrollbar").filter(isUnconditioned)).not.toHaveLength(0);
    expect(rulesFor(css, "::-webkit-scrollbar-thumb").filter(isUnconditioned)).not.toHaveLength(0);
  });

  it("keeps the standards path at a normal, acquirable width", () => {
    expect(globalValues("*", "scrollbar-width")).toEqual(["auto"]);
    const thin = rulesOf(css).filter((rule) => declarationValue(rule, "scrollbar-width") === "thin");
    expect(thin.map((rule) => rule.selector)).toEqual([]);
  });

  it("declares scrollbar-color so the bar is themed", () => {
    expect(globalValues("*", "scrollbar-color")).toHaveLength(1);
  });

  it("makes the thumb a rounded pill", () => {
    expect(globalValues("::-webkit-scrollbar-thumb", "border-radius")).toHaveLength(1);
  });

  it("keeps a 16px hit gutter and a 10px visible thumb", () => {
    expect(globalValues("::-webkit-scrollbar", "width")).toEqual(["16px"]);
    expect(globalValues("::-webkit-scrollbar", "height")).toEqual(["16px"]);
    expect(globalValues("::-webkit-scrollbar-thumb", "border")).toEqual(["3px solid transparent"]);
    expect(globalValues("::-webkit-scrollbar-thumb", "background-clip")).toEqual(["padding-box"]);
  });

  it("keeps the track transparent", () => {
    expect(globalValues("::-webkit-scrollbar-track", "background")).toEqual(["transparent"]);
  });

  it("brightens the thumb while its whole owner is hovered or contains focus", () => {
    const brightened = rulesFor(css, "::-webkit-scrollbar-thumb:hover").flatMap(selectorsOf);
    expect(brightened).toContain("*:hover::-webkit-scrollbar-thumb");
    expect(brightened).toContain("*:focus-within::-webkit-scrollbar-thumb");
    const owners = rulesWithSelectors(css, ["*:hover", "*:focus-within"]);
    expect(owners.map((rule) => declarationValue(rule, "scrollbar-color"))).toEqual([
      "var(--scrollbar-thumb-hover) transparent",
    ]);
  });

  it("keeps the resting thumb at least 3:1 against every base surface in both themes", () => {
    const surfaceTokens = ["--background", "--surface", "--surface-muted", "--surface-sunken"];
    const sources = tokenSources(css);
    for (const theme of ["light", "dark"] as const) {
      const tokens = themeTokens(css, theme);
      const thumb = resolveRgb(tokens, "--scrollbar-thumb", sources);
      for (const surfaceToken of surfaceTokens) {
        expect(
          contrast(thumb, resolveRgb(tokens, surfaceToken, sources)),
          `${theme} ${surfaceToken}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("reserves a stable gutter for passive owners and shows their focus in the thumb", () => {
    expect(globalValues("[data-passive-scroll-region]", "scrollbar-gutter")).toEqual(["stable"]);
    // The visible treatment is the thumb brightening while focus is inside, not a
    // ring around the region: that ring outlined a whole pane or modal body the
    // moment a key was pressed after a click (app-chrome-conventions).
    expect(rulesFor(css, "*:focus-within::-webkit-scrollbar-thumb")).not.toHaveLength(0);
    const ringed = rulesFor(css, "[data-passive-scroll-region]:focus-visible")
      .map((rule) => declarationValue(rule, "outline"))
      .filter((outline) => outline !== undefined && outline !== "none");
    expect(ringed).toEqual([]);
  });

  it("retains both color-scheme declarations (light and dark)", () => {
    // The light value sits on the unconditioned :root, the dark one on the
    // :root the dark media query holds.
    expect(rulesFor(css, ":root").filter(isUnconditioned).map((rule) => declarationValue(rule, "color-scheme")))
      .toContain("light");
    const dark = rulesFor(css, ":root").filter(
      (rule) => atRulesAround(rule).join(" ") === "@media (prefers-color-scheme: dark)",
    );
    expect(dark.map((rule) => declarationValue(rule, "color-scheme"))).toContain("dark");
  });
});
