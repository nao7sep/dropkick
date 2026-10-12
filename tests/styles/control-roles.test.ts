// @vitest-environment node
//
// One anatomy per role (interface-styling-conventions). The Button primitive
// and App.css's control roles hold the decisions; these tests pin them so a
// later pass cannot drift a size, re-colour a non-destructive action red, or
// leave a role's press unstated.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { buttonClass } from "../../src/components/shared/Button";

const ROOT = join(__dirname, "..", "..");
const css = readFileSync(join(ROOT, "src/App.css"), "utf8");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}
const sources = tsxFiles(join(ROOT, "src")).map(
  (path) => [relative(ROOT, path), readFileSync(path, "utf8")] as const,
);

describe("control anatomy values", () => {
  it("keeps Dropkick's two control heights and its corner scale", () => {
    expect(css).toMatch(/--control-h:\s*32px;/);
    expect(css).toMatch(/--control-h-sm:\s*28px;/);
    expect(css).toMatch(/--radius-sm:\s*6px;/);
    expect(css).toMatch(/--radius-control:\s*8px;/);
    expect(css).toMatch(/--radius-card:\s*10px;/);
    expect(css).toMatch(/--radius-dialog:\s*14px;/);
    expect(css).toMatch(/--motion:\s*120ms;/);
  });

  it("names a role and a size through one class vocabulary", () => {
    expect(buttonClass()).toBe("dk-btn dk-btn-secondary");
    expect(buttonClass("danger-confirm", "sm")).toBe("dk-btn dk-btn-danger-confirm dk-btn-sm");
  });

  it("states a hover and a press for every button role", () => {
    for (const role of ["primary", "secondary", "quiet", "danger", "danger-confirm", "warning-confirm", "tint"]) {
      expect(css, role).toContain(`.dk-btn-${role}:hover:not(:disabled)`);
      expect(css, role).toContain(`.dk-btn-${role}:active:not(:disabled)`);
    }
  });
});

describe("destructive roles", () => {
  it("keeps the red fill for the confirming button alone", () => {
    const filled = sources.filter(([, source]) => /bg-danger-solid|dk-btn-danger-confirm|"danger-confirm"/.test(source));
    expect(filled.map(([name]) => name).sort()).toEqual(
      ["src/components/shared/AppDialogHost.tsx", "src/components/shared/Button.tsx"],
    );
  });

  it("styles no reorder, retry or reload red", () => {
    const detail = readFileSync(join(ROOT, "src/components/task-detail/TaskDetail.tsx"), "utf8");
    const bulk = readFileSync(join(ROOT, "src/components/task-detail/BulkActions.tsx"), "utf8");
    const list = readFileSync(join(ROOT, "src/components/task-list/TaskListPane.tsx"), "utf8");
    for (const source of [detail, bulk]) {
      const dropkick = source.slice(source.lastIndexOf("<Button", source.indexOf("Dropkick\n")), source.indexOf("Dropkick\n"));
      expect(dropkick).not.toMatch(/danger/);
    }
    // Every Retry in the list pane: the load-error card's leads, and none is red.
    const retries = [...list.matchAll(/t\("taskList\.retry"\)/g)].map(({ index }) =>
      list.slice(list.lastIndexOf("<Button", index), index),
    );
    expect(retries.length).toBeGreaterThan(1);
    for (const retry of retries) expect(retry).not.toMatch(/danger/);
    const loadError = list.slice(list.indexOf("function LoadErrorPane("));
    const cardRetry = loadError.slice(loadError.lastIndexOf("<Button", loadError.indexOf('t("taskList.retry")')), loadError.indexOf('t("taskList.retry")'));
    expect(cardRetry).toContain('variant="primary"');
  });

  it("opens deletion with the outlined trigger", () => {
    for (const file of ["src/components/task-detail/TaskDetail.tsx", "src/components/task-detail/BulkActions.tsx"]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      const at = source.indexOf('t("detail.delete")');
      expect(source.slice(source.lastIndexOf("<Button", at), at), file).toContain('variant="danger"');
    }
  });
});

describe("About", () => {
  it("drops its drawn title and leads with the app's name", () => {
    const about = readFileSync(join(ROOT, "src/components/layout/AboutModal.tsx"), "utf8");
    expect(about).toContain("titleVisuallyHidden");
    expect(about).toMatch(/text-2xl[^"]*">Dropkick</);
  });
});

describe("menus", () => {
  it("size to their longest item: content width, a floor at most, never a fixed width", () => {
    const tabBar = readFileSync(join(ROOT, "src/components/layout/TabBar.tsx"), "utf8");
    const contents = [...tabBar.matchAll(/<DropdownMenu\.Content[\s\S]*?className="([^"]*)"/g)].map((m) => m[1]!);
    expect(contents.length).toBeGreaterThan(0);
    for (const className of contents) {
      expect(className).toContain("w-max");
      expect(className).toMatch(/max-w-\[var\(--radix-dropdown-menu-content-available-width\)\]/);
      expect(className).not.toMatch(/(^|\s)w-(?!max)[\w[]/);
    }
    // `w-max` keeps every label on one line while the menu fits; a label wider
    // than the available width wraps rather than being clipped, since a menu
    // label has nowhere else to show whole (composite-control-conventions).
    expect(css).not.toMatch(/\.dk-menu-item,\s*\.dk-menu-control\s*\{[^}]*white-space:\s*nowrap/);
  });

  it("give a contained control row the item row's anatomy", () => {
    // One rule owns padding, height, gap and text for both, so a control row's
    // icon and label line up with the items' and its control keeps their inset.
    const shared = css.match(/\.dk-menu-item,\s*\.dk-menu-control\s*\{([^}]*)\}/)?.[1];
    expect(shared).toBeDefined();
    for (const declaration of [
      /display:\s*flex/,
      /gap:\s*8px/,
      /min-height:\s*30px/,
      /padding:\s*5px 10px/,
      /font-size:\s*13px/,
    ]) {
      expect(shared).toMatch(declaration);
    }
    // The control row takes no item state: no pointer cursor, no highlight.
    const controlRules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]*)\{/g)]
      .map((m) => m[1]!.trim())
      .filter((selector) => selector.includes("dk-menu-control"));
    expect(controlRules).toHaveLength(1);
    expect(controlRules[0]).toMatch(/^\.dk-menu-item,\s*\.dk-menu-control$/);
  });
});

describe("task list", () => {
  it("draws groups as cards with no stripe for the rounding to bend", () => {
    const list = readFileSync(join(ROOT, "src/components/task-list/TaskListPane.tsx"), "utf8");
    expect(list).toContain("GROUP_CARDS");
    expect(list).not.toMatch(/border-l-4|border-l-group-/);
  });
});

describe("per-item dismiss", () => {
  it("centres on the item's first line through one shared class", () => {
    expect(css).toMatch(/\.dk-line-dismiss\s*\{[^}]*margin-block:\s*calc\(\(1lh - var\(--dk-dismiss-size\)\) \/ 2\)/);
    for (const file of [
      "src/components/shared/InlineResult.tsx",
      "src/components/shared/ToastHost.tsx",
      "src/components/layout/TabBar.tsx",
    ]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source, file).toContain("dk-line-dismiss");
      expect(source, file).not.toMatch(/dk-icon-btn-on-danger[^"]*-my-/);
    }
  });
});

describe("dialog footers", () => {
  // A footer too narrow for its buttons, at the minimum window in a long
  // language, moves a button to a new row; the buttons never shrink or wrap
  // their labels, and with `justify-end` a row that could not wrap would spill
  // past the dialog's left edge (German and Portuguese "Changes Not Saved" did).
  it("wraps whole buttons onto a new row instead of squeezing or spilling them", () => {
    const button = css.match(/\.dk-btn\s*\{([^}]*)\}/)?.[1];
    expect(button).toMatch(/flex-shrink:\s*0/);
    expect(button).toMatch(/white-space:\s*nowrap/);
    const footers = sources.flatMap(([path, text]) =>
      [...text.matchAll(/footerClassName\s*=\s*\{?"([^"]*)"/g)].map((match) => `${path}: ${match[1]}`),
    );
    expect(footers.length).toBeGreaterThan(0);
    expect(footers.filter((footer) => !/\bflex-wrap\b/.test(footer))).toEqual([]);
  });
});
