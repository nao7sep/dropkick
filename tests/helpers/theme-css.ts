// Pure helpers for reading App.css's theme tokens and measuring contrast. The
// light tokens are the custom properties of the unconditioned `:root` rules;
// the dark tokens are those of the `:root` rule inside
// `@media (prefers-color-scheme: dark)`. Both come from the PostCSS tree.
// Light tokens alias Tailwind's palette, so `var(--color-*)` references
// resolve through Tailwind's theme.css, whose colors are OKLCH.

import type { Root } from "postcss";
import {
  atRulesAround,
  customProperties,
  firstCustomProperties,
  isUnconditioned,
  readCss,
  rulesOf,
  selectorOf,
} from "./css-tree";

export type Rgb = [number, number, number];
export type Tokens = ReadonlyMap<string, string>;

const DARK = "@media (prefers-color-scheme: dark)";

export function themeTokens(css: Root, theme: "light" | "dark"): Tokens {
  const roots = rulesOf(css).filter((rule) => selectorOf(rule) === ":root");
  const rules =
    theme === "light"
      ? roots.filter(isUnconditioned)
      : roots.filter((rule) => {
          const around = atRulesAround(rule);
          return around.length === 1 && around[0] === DARK;
        });
  if (rules.length === 0) {
    throw new Error(theme === "light" ? "top-level :root block missing" : ":root block missing inside the dark media query");
  }
  return customProperties(rules);
}

// Every custom property App.css and Tailwind's theme declare, the first
// declaration of each, for references a theme block does not define itself.
export function tokenSources(css: Root): Tokens {
  return firstCustomProperties(css, readCss("node_modules/tailwindcss/theme.css"));
}

export function tokenValue(tokens: Tokens, token: string): string {
  const value = tokens.get(token);
  if (value === undefined) throw new Error(`${token} must be defined`);
  return value.replace(/\/\*.*?\*\//g, "").trim();
}

// Resolves a token in `theme` to sRGB (0–255 channels), following var()
// references through the same theme first, as the cascade would for that
// theme, then through `sources` (App.css plus Tailwind's theme.css).
//
// A declaration's value is a string to PostCSS, with no tree below it, so the
// var(), hex and OKLCH forms are read from that string.
export function resolveRgb(theme: Tokens, token: string, sources: Tokens): Rgb {
  let value = tokenValue(theme, token);
  for (let depth = 0; depth < 4; depth += 1) {
    const reference = value.match(/^var\((--[^)]+)\)$/)?.[1];
    if (reference === undefined) break;
    value = theme.has(reference) ? tokenValue(theme, reference) : tokenValue(sources, reference);
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
  if (!oklch) throw new Error(`${token} must resolve to an opaque hex or OKLCH color`);
  const lightness = Number(oklch[1]) / 100;
  const chroma = Number(oklch[2]);
  const hue = Number(oklch[3]) * Math.PI / 180;
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

export function luminance(rgb: Rgb): number {
  const [red, green, blue] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

export function contrast(first: Rgb, second: Rgb): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
