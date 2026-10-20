import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { appCss } from "../helpers/css-tree";
import { contrast, resolveRgb, themeTokens, tokenSources, type Rgb } from "../helpers/theme-css";
import {
  classAttributes,
  classTokens,
  parseSource,
  stringsIn,
  stringTokens,
  tsxSources,
  type Ast,
} from "../helpers/tsx-classes";

const css = appCss();
// The native window's background is Rust source, and the toolchain here has
// no Rust parser, so its colour arms are read as text.
const themeRs = readFileSync(
  fileURLToPath(new URL("../../src-tauri/src/theme.rs", import.meta.url)),
  "utf8",
);
const sources = tokenSources(css);
const themes = ["light", "dark"] as const;
const tokens = { light: themeTokens(css, "light"), dark: themeTokens(css, "dark") };
const components = tsxSources();

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
  // A dark block overrides only what changes; anything it leaves out keeps its
  // light value.
  const resolve = (token: string): Rgb => {
    try {
      return resolveRgb(tokens[theme], token, sources);
    } catch {
      return resolveRgb(tokens.light, token, sources);
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
      const expected = resolveRgb(tokens[theme], "--background", sources);
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
const LITERAL_INKS = ["text-white", "text-black"];

function literalInks(file: string, program: Ast): string[] {
  return stringTokens(program)
    .filter(({ token }) => LITERAL_INKS.some((literal) => token.includes(literal)))
    .map(({ token, line }) => `${file}:${line} uses ${token}`);
}

describe("control inks come from tokens", () => {
  it("never paints a label with a literal black or white", () => {
    expect(components.flatMap(({ file, ast }) => literalInks(file, ast))).toEqual([]);
  });

  it("finds a planted literal ink, behind a variant too", () => {
    const planted = 'const A = () => <button className="bg-danger hover:text-white">x</button>;';
    expect(literalInks("planted.tsx", parseSource(planted, "planted.tsx"))).toEqual([
      "planted.tsx:1 uses hover:text-white",
    ]);
  });
});

// The line that closes a dialog's header band and opens its footer band is a
// band edge (modal-dialog-conventions: a 1 px line at the band-edge strength of
// interface-styling-conventions), so it is drawn with the band-edge token
// --border, never a control edge's colour or a raw shade. The shared shell
// draws both lines, and a caller that replaces the footer's classes draws its
// own; each such class string that draws a top or bottom line names the token.
const SHELL = ["src/components/shared/AppModal.tsx", "src/components/shared/AppDialogHost.tsx"];
const BAND_LINE = /^border-[bt](-\d+|-\[[^\]]*\])?$/;

function bandLines(file: string, program: Ast): string[] {
  const classStrings = [
    ...(SHELL.includes(file) ? classListsInStrings(program) : []),
    ...classAttributes(program)
      .filter(({ attribute }) => attribute === "footerClassName")
      .map(({ tokens, line }) => ({ tokens, line })),
  ];
  return classStrings
    .filter(({ tokens }) => tokens.some((token) => BAND_LINE.test(token)) && !tokens.includes("border-border"))
    .map(({ tokens, line }) => `${file}:${line}: ${tokens.join(" ")}`);
}

// Each string of the program as its own class list.
function classListsInStrings(program: Ast): Array<{ tokens: string[]; line: number }> {
  return stringsIn(program).map(({ value, line }) => ({ tokens: classTokens(value), line }));
}

describe("dialog band separators", () => {
  it("draw the header and footer lines with the band-edge token", () => {
    // The shell's own header and footer lines are found, so the scan is not
    // passing over nothing.
    const shellLines = components
      .filter(({ file }) => SHELL.includes(file))
      .flatMap(({ ast }) => classListsInStrings(ast))
      .filter(({ tokens }) => tokens.some((token) => BAND_LINE.test(token)));
    expect(shellLines.length).toBeGreaterThanOrEqual(2);
    expect(components.flatMap(({ file, ast }) => bandLines(file, ast))).toEqual([]);
  });

  it("finds a planted band line in another colour", () => {
    const planted =
      'const A = () => <AppModal footerClassName="flex border-t border-control-edge px-6" />;';
    expect(bandLines("planted.tsx", parseSource(planted, "planted.tsx"))).toEqual([
      "planted.tsx:1: flex border-t border-control-edge px-6",
    ]);
  });

  // A control edge is always clearly stronger than any separator
  // (interface-styling-conventions, line kinds).
  it("keeps the control-border token at least as visible as the divider token in both themes", () => {
    for (const theme of themes) {
      const dividerContrast = pairContrast(theme, "--border", "--surface");
      const controlEdgeContrast = pairContrast(theme, "--control-edge", "--surface");
      expect(controlEdgeContrast, theme).toBeGreaterThanOrEqual(dividerContrast);
    }
  });
});
