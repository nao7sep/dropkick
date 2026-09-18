import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { contrast, resolveRgb, themeBlock, type Rgb } from "../helpers/theme-css";

const css = readFileSync(fileURLToPath(new URL("../../src/App.css", import.meta.url)), "utf8");
const tailwindTheme = readFileSync(
  fileURLToPath(new URL("../../node_modules/tailwindcss/theme.css", import.meta.url)),
  "utf8",
);
const themeRs = readFileSync(
  fileURLToPath(new URL("../../src-tauri/src/theme.rs", import.meta.url)),
  "utf8",
);
const sources = `${css}\n${tailwindTheme}`;
const themes = ["light", "dark"] as const;
const GROUPS = ["pastdue", "critical", "duetoday", "important", "urgent", "duesoon"];

// Foreground tokens on the surfaces the components place them on. The muted ink
// on hover fills is absent on purpose: every such control switches to full ink
// on hover.
const TEXT_PAIRS: ReadonlyArray<[string, string]> = [
  ...["--ink-strong", "--ink", "--ink-soft", "--ink-muted"].flatMap(
    (ink): Array<[string, string]> => [[ink, "--background"], [ink, "--surface"]],
  ),
  ["--ink-strong", "--surface-muted"],
  ["--ink", "--surface-muted"],
  ...["--primary-solid", "--primary-solid-hover", "--danger-solid", "--danger-solid-hover", "--warning-solid", "--warning-solid-strong"].map(
    (fill): [string, string] => ["--ink-inverted", fill],
  ),
  ["--primary", "--surface"],
  ["--primary", "--background"],
  ["--primary", "--primary-surface"],
  ["--primary", "--primary-surface-strong"],
  ["--primary-hover", "--surface"],
  ["--danger", "--surface"],
  ["--danger", "--background"],
  ["--danger", "--danger-surface"],
  ["--danger-fg-strong", "--danger-surface-strong"],
  ["--attention", "--surface"],
  ["--attention", "--attention-surface"],
  ["--success", "--surface"],
  ["--success", "--success-surface"],
  ["--warning", "--surface"],
  ["--warning", "--warning-surface"],
  ["--warning-strong", "--warning-surface"],
  ...GROUPS.flatMap((group): Array<[string, string]> => [
    [`--group-${group}-fg`, "--surface"],
    [`--group-${group}-fg`, `--group-${group}-tint`],
    [`--group-${group}-fg`, "--surface-sunken"],
  ]),
];

// Boundaries that alone identify a control or its state: a form field's
// outline, and the focus border that replaces it.
const BOUNDARY_PAIRS: ReadonlyArray<[string, string]> = [
  ["--input-border", "--surface"],
  ["--primary-ring", "--surface"],
];

function pairContrast(theme: (typeof themes)[number], foreground: string, background: string): number {
  const block = themeBlock(css, theme);
  const lightBlock = themeBlock(css, "light");
  // A dark block overrides only what changes; anything it leaves out keeps its
  // light value.
  const resolve = (token: string): Rgb => {
    try {
      return resolveRgb(block, token, sources);
    } catch {
      return resolveRgb(lightBlock, token, sources);
    }
  };
  return contrast(resolve(foreground), resolve(background));
}

describe("theme token contrast", () => {
  for (const theme of themes) {
    it(`keeps text at 4.5:1 or more in the ${theme} theme`, () => {
      for (const [foreground, background] of TEXT_PAIRS) {
        expect(pairContrast(theme, foreground, background), `${foreground} on ${background}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`keeps control boundaries at 3:1 or more in the ${theme} theme`, () => {
      for (const [foreground, background] of BOUNDARY_PAIRS) {
        expect(pairContrast(theme, foreground, background), `${foreground} on ${background}`)
          .toBeGreaterThanOrEqual(3);
      }
    });
  }
});

describe("native window background", () => {
  function rustBackground(arm: string): Rgb {
    const match = themeRs.match(
      new RegExp(`${arm} => Color\\(0x([0-9a-f]{2}), 0x([0-9a-f]{2}), 0x([0-9a-f]{2}), 0xff\\)`, "i"),
    );
    if (!match) throw new Error(`window_background arm ${arm} missing`);
    return [match[1]!, match[2]!, match[3]!].map((part) => Number.parseInt(part, 16)) as Rgb;
  }

  it("matches --background in each theme so the frame behind the page never flashes", () => {
    for (const [theme, arm] of [["dark", "Theme::Dark"], ["light", "_"]] as const) {
      const expected = resolveRgb(themeBlock(css, theme), "--background", sources);
      rustBackground(arm).forEach((channel, index) => {
        expect(Math.abs(channel - expected[index]!), `${theme} channel ${index}`).toBeLessThanOrEqual(1);
      });
    }
  });
});
