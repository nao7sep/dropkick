import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
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

function tsxSources(): Array<readonly [string, string]> {
  const root = fileURLToPath(new URL("../../src", import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : entry.name.endsWith(".tsx") ? [path] : [];
    });
  return walk(root).map((path) => [relative(root, path), readFileSync(path, "utf8")] as const);
}
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
  // The neutral control's ladder carries its label at every step.
  ...["--control", "--control-hover", "--control-pressed"].map(
    (fill): [string, string] => ["--ink", fill],
  ),
  ["--danger", "--danger-surface-strong"],
  ...["--primary-solid", "--primary-solid-hover", "--primary-solid-pressed", "--danger-solid", "--danger-solid-hover", "--danger-solid-pressed", "--warning-solid", "--warning-solid-strong", "--warning-solid-pressed"].map(
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
    // Task rows have no fill and sit on their group's card tint.
    ["--ink", `--group-${group}-tint`],
  ]),
  // A selected row, and the default group's card.
  ["--ink", "--primary-surface-strong"],
  ["--ink", "--surface-sunken"],
];

// The focus border identifies focus on its own, so it keeps 3:1. Lines follow
// the interface-styling-conventions' line kinds instead of a WCAG threshold:
// a control edge (a field's outline, a bordered button) sits at 2.0-2.5 against
// the surface it is painted on; company/tools/measure-lines checks every line
// as rendered.
const BOUNDARY_PAIRS: ReadonlyArray<[string, string]> = [
  ["--primary-ring", "--surface"],
];
const CONTROL_EDGE_PAIRS: ReadonlyArray<[string, string]> = [
  ["--input-border", "--surface"],
  ["--control-edge", "--control"],
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

    it(`keeps the focus border at 3:1 or more in the ${theme} theme`, () => {
      for (const [foreground, background] of BOUNDARY_PAIRS) {
        expect(pairContrast(theme, foreground, background), `${foreground} on ${background}`)
          .toBeGreaterThanOrEqual(3);
      }
    });

    it(`keeps control edges within 2.0-2.5 in the ${theme} theme`, () => {
      for (const [foreground, background] of CONTROL_EDGE_PAIRS) {
        const ratio = pairContrast(theme, foreground, background);
        expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(2);
        expect(ratio, `${foreground} on ${background}`).toBeLessThanOrEqual(2.55);
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

// Every colour a control draws with is a token, so that changing it moves the
// pairs above. The crash screen's button was the one that was not: a literal
// `text-white` on `bg-danger`, which is the TEXT red — pale in the dark theme, so
// white on it measured 2.77:1 while every tokenised fill in the app held 4.5.
describe("control inks come from tokens", () => {
  it("never paints a label with a literal black or white", () => {
    for (const [name, source] of tsxSources())
      for (const literal of ["text-white", "text-black"])
        expect(source, `${name} uses ${literal}`).not.toContain(literal);
  });
});

// The line that closes a dialog's header band and opens its footer band must
// stay as visible as the app's own control borders (modal-dialog-conventions:
// "never fainter than the app's own control borders in either theme"). It is
// pinned to the same --control-edge token the buttons and fields use, rather
// than the fainter --border token dividers elsewhere use, so a future edit
// can't quietly fade it back.
describe("dialog band separators", () => {
  it("draw the header and footer lines with the control-border token, not the fainter divider token", () => {
    for (const [name, source] of tsxSources().filter(
      ([path]) => path === "shared/AppModal.tsx" || path === "shared/AppDialogHost.tsx",
    )) {
      expect(source, `${name} header/footer border`).not.toMatch(/border-[bt] border-border\b/);
    }
  });

  it("keeps the control-border token at least as visible as the divider token in both themes", () => {
    for (const theme of themes) {
      const dividerContrast = pairContrast(theme, "--border", "--surface");
      const controlEdgeContrast = pairContrast(theme, "--control-edge", "--surface");
      expect(controlEdgeContrast, theme).toBeGreaterThanOrEqual(dividerContrast);
    }
  });
});
