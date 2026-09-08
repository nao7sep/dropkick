import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

type Rgb = [number, number, number];

function selectorBlock(selector: string): string {
  const start = css.search(new RegExp(`^${selector.replace(".", "\\.")}\\s*\\{`, "m"));
  expect(start, `${selector} must exist`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("\n}", open);
  return css.slice(open, close);
}

function tokenValue(source: string, token: string): string {
  const match = source.match(new RegExp(`${token.replaceAll("-", "\\-")}\\s*:\\s*([^;]+);`));
  expect(match, `${token} must be defined`).toBeTruthy();
  return match![1]!.trim();
}

function resolveRgb(block: string, token: string): Rgb {
  let value = tokenValue(block, token);
  const sources = `${css}\n${tailwindTheme}`;
  for (let depth = 0; depth < 4; depth += 1) {
    const reference = value.match(/^var\((--[^)]+)\)$/)?.[1];
    if (reference === undefined) break;
    value = tokenValue(sources, reference);
  }
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex !== undefined) {
    const expanded = hex.length === 3
      ? [...hex].map((part) => `${part}${part}`).join("")
      : hex;
    return [0, 2, 4].map(
      (offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16),
    ) as Rgb;
  }

  const oklch = value.match(/^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)$/);
  expect(oklch, `${token} must resolve to an opaque hex or OKLCH color`).toBeTruthy();
  const lightness = Number(oklch![1]) / 100;
  const chroma = Number(oklch![2]);
  const hue = Number(oklch![3]) * Math.PI / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((channel) => {
    const clipped = Math.min(1, Math.max(0, channel));
    const srgb = clipped <= 0.0031308
      ? 12.92 * clipped
      : 1.055 * clipped ** (1 / 2.4) - 0.055;
    return srgb * 255;
  }) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [red, green, blue] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: Rgb, second: Rgb): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

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
    for (const selector of [":root", ".dark"]) {
      const block = selectorBlock(selector);
      const thumb = resolveRgb(block, "--scrollbar-thumb");
      for (const surfaceToken of surfaceTokens) {
        expect(
          contrast(thumb, resolveRgb(block, surfaceToken)),
          `${selector} ${surfaceToken}`,
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
