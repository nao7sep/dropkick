// @vitest-environment node
//
// One anatomy per role (interface-styling-conventions). The Button primitive
// and App.css's control roles hold the decisions; these tests pin them so a
// later pass cannot drift a size, re-colour a non-destructive action red, or
// leave a role's press unstated.

import { describe, expect, it } from "vitest";
import { buttonClass } from "../../src/components/shared/Button";
import {
  appCss,
  declarationValue,
  isUnconditioned,
  rulesFor,
  rulesOf,
  rulesWithSelectors,
  selectorsOf,
} from "../helpers/css-tree";
import {
  attributeString,
  declarationNamed,
  elementText,
  jsxElements,
  parseSource,
  readSource,
  resolvedClasses,
  stringsIn,
  stringTokens,
  translationKeys,
  tsxSources,
  utilityOf,
  walk,
  type Ast,
  type JsxElement,
  type Source,
} from "../helpers/tsx-classes";

const css = appCss();
const sources = tsxSources();
const allSelectors = rulesOf(css).flatMap(selectorsOf);

// A custom property's value on the unconditioned :root.
function rootToken(token: string): string | undefined {
  return rulesFor(css, ":root")
    .filter(isUnconditioned)
    .map((rule) => declarationValue(rule, token))
    .find((value) => value !== undefined);
}

// The strings a Button's attributes can hold, e.g. its variant and className,
// through both arms of a condition and any constant they name.
function buttonAttributes(program: Ast, element: JsxElement): string {
  return [...element.attributes.values()].flatMap((value) => resolvedClasses(program, value)).join(" ");
}

function buttons(program: Ast, test: (element: JsxElement) => boolean): JsxElement[] {
  return jsxElements(program).filter((element) => element.name === "Button" && test(element));
}

describe("control anatomy values", () => {
  it("keeps Dropkick's two control heights and its corner scale", () => {
    expect(rootToken("--control-h")).toBe("32px");
    expect(rootToken("--control-h-sm")).toBe("28px");
    expect(rootToken("--radius-sm")).toBe("6px");
    expect(rootToken("--radius-control")).toBe("8px");
    expect(rootToken("--radius-card")).toBe("10px");
    expect(rootToken("--radius-dialog")).toBe("14px");
    expect(rootToken("--motion")).toBe("120ms");
  });

  it("names a role and a size through one class vocabulary", () => {
    expect(buttonClass()).toBe("dk-btn dk-btn-secondary");
    expect(buttonClass("danger-confirm", "sm")).toBe("dk-btn dk-btn-danger-confirm dk-btn-sm");
  });

  it("states a hover and a press for every button role", () => {
    for (const role of ["primary", "secondary", "quiet", "danger", "danger-confirm", "warning-confirm", "tint"]) {
      expect(allSelectors, role).toContain(`.dk-btn-${role}:hover:not(:disabled)`);
      expect(allSelectors, role).toContain(`.dk-btn-${role}:active:not(:disabled)`);
    }
  });
});

// Files whose strings put the red fill on something: the filled utility, the
// confirming role's class, or the role's name.
function redFills(files: readonly Source[]): string[] {
  return files
    .filter(({ ast }) =>
      stringsIn(ast).some(
        ({ value }) =>
          value === "danger-confirm" ||
          value.split(/\s+/).some((token) => token.includes("bg-danger-solid") || token.includes("dk-btn-danger-confirm")),
      ),
    )
    .map(({ file }) => file)
    .sort();
}

describe("destructive roles", () => {
  it("keeps the red fill for the confirming button alone", () => {
    expect(redFills(sources)).toEqual(["src/components/shared/AppDialogHost.tsx", "src/components/shared/Button.tsx"]);
  });

  it("finds a planted red fill", () => {
    const planted: Source[] = [
      { file: "a.tsx", ast: parseSource('const A = () => <Button variant="danger-confirm">Retry</Button>;', "a.tsx") },
      { file: "b.tsx", ast: parseSource('const B = () => <button className="hover:bg-danger-solid-hover">x</button>;', "b.tsx") },
      { file: "c.tsx", ast: parseSource('const C = () => <Button variant="danger">x</Button>; // danger-confirm', "c.tsx") },
    ];
    expect(redFills(planted)).toEqual(["a.tsx", "b.tsx"]);
  });

  it("styles no reorder, retry or reload red", () => {
    for (const file of ["src/components/task-detail/TaskDetail.tsx", "src/components/task-detail/BulkActions.tsx"]) {
      const { ast } = readSource(file);
      const dropkick = buttons(ast, (element) => elementText(element) === "Dropkick");
      expect(dropkick.length, file).toBeGreaterThan(0);
      for (const button of dropkick) expect(buttonAttributes(ast, button), file).not.toMatch(/danger/);
    }
    // Every Retry in the list pane: the load-error card's leads, and none is red.
    const list = readSource("src/components/task-list/TaskListPane.tsx").ast;
    const isRetry = (element: JsxElement) => translationKeys(element).includes("taskList.retry");
    const retries = buttons(list, isRetry);
    expect(retries.length).toBeGreaterThan(1);
    for (const retry of retries) expect(buttonAttributes(list, retry)).not.toMatch(/danger/);
    const loadError = declarationNamed(list, "LoadErrorPane");
    expect(loadError).toBeDefined();
    const cardRetries = buttons(loadError!, isRetry);
    expect(cardRetries).toHaveLength(1);
    expect(attributeString(cardRetries[0]!.attributes.get("variant"))).toBe("primary");
  });

  it("opens deletion with the outlined trigger", () => {
    for (const file of ["src/components/task-detail/TaskDetail.tsx", "src/components/task-detail/BulkActions.tsx"]) {
      const deletes = buttons(readSource(file).ast, (element) => translationKeys(element).includes("detail.delete"));
      expect(deletes.length, file).toBeGreaterThan(0);
      for (const button of deletes) expect(attributeString(button.attributes.get("variant")), file).toBe("danger");
    }
  });
});

describe("About", () => {
  it("drops its drawn title and leads with the app's name", () => {
    const about = readSource("src/components/layout/AboutModal.tsx").ast;
    const elements = jsxElements(about);
    expect(elements.some(({ attributes }) => attributes.has("titleVisuallyHidden"))).toBe(true);
    expect(
      elements.some((element) => element.classes.includes("text-2xl") && elementText(element) === "Dropkick"),
    ).toBe(true);
  });
});

describe("menus", () => {
  it("size to their longest item up to a narrow cap: content width, a floor at most, never a fixed width", () => {
    const tabBar = readSource("src/components/layout/TabBar.tsx").ast;
    const contents = jsxElements(tabBar).filter(({ name }) => name === "DropdownMenu.Content");
    expect(contents.length).toBeGreaterThan(0);
    for (const { classes } of contents) {
      expect(classes).toContain("w-max");
      // Narrow even in a wide window: long names and paths end in "…" at the
      // cap rather than stretching the menu toward the window's edge.
      expect(classes).toContain("max-w-[min(var(--menu-max-width),var(--radix-dropdown-menu-content-available-width))]");
      expect(classes.filter((token) => /^w-/.test(utilityOf(token)) && utilityOf(token) !== "w-max")).toEqual([]);
    }
    expect(rulesFor(css, ".dk-menu").map((rule) => declarationValue(rule, "--menu-max-width"))).toContain("20rem");
    // Items never wrap: the shared item role keeps its label on one line.
    const shared = rulesWithSelectors(css, [".dk-menu-item", ".dk-menu-control"]);
    expect(shared.map((rule) => declarationValue(rule, "white-space"))).toEqual(["nowrap"]);
  });

  it("give a contained control row the item row's anatomy", () => {
    // One rule owns padding, height, gap and text for both, so a control row's
    // icon and label line up with the items' and its control keeps their inset.
    const shared = rulesWithSelectors(css, [".dk-menu-item", ".dk-menu-control"]);
    expect(shared).toHaveLength(1);
    for (const [property, value] of [
      ["display", "flex"],
      ["gap", "8px"],
      ["min-height", "30px"],
      ["padding", "5px 10px"],
      ["font-size", "13px"],
    ] as const) {
      expect(declarationValue(shared[0]!, property), property).toBe(value);
    }
    // The control row takes no item state: no pointer cursor, no highlight.
    const controlRules = rulesOf(css).filter((rule) => selectorsOf(rule).some((s) => s.includes("dk-menu-control")));
    expect(controlRules).toEqual(shared);
  });
});

describe("task list", () => {
  it("draws groups as cards with no stripe for the rounding to bend", () => {
    const list = readSource("src/components/task-list/TaskListPane.tsx").ast;
    // The cards take their tint and edge from GROUP_CARDS, through a className.
    let fromGroupCards = false;
    walk(list, (node, ancestors) => {
      if (
        node.type === "Identifier" &&
        node.name === "GROUP_CARDS" &&
        ancestors.some((ancestor) => ancestor.type === "JSXAttribute" && ancestor.name.name === "className")
      )
        fromGroupCards = true;
    });
    expect(fromGroupCards).toBe(true);
    const stripes = stringTokens(list).filter(({ token }) => /border-l-4|border-l-group-/.test(token));
    expect(stripes).toEqual([]);
  });
});

describe("per-item dismiss", () => {
  it("centres on the item's first line through one shared class", () => {
    expect(rulesFor(css, ".dk-line-dismiss").map((rule) => declarationValue(rule, "margin-block"))).toEqual([
      "calc((1lh - var(--dk-dismiss-size)) / 2)",
    ]);
    for (const file of [
      "src/components/shared/InlineResult.tsx",
      "src/components/shared/ToastHost.tsx",
      "src/components/layout/TabBar.tsx",
    ]) {
      const elements = jsxElements(readSource(file).ast);
      expect(elements.some(({ classes }) => classes.includes("dk-line-dismiss")), file).toBe(true);
      const nudged = elements.filter(
        ({ classes }) =>
          classes.includes("dk-icon-btn-on-danger") && classes.some((token) => /^-my-/.test(utilityOf(token))),
      );
      expect(nudged, file).toEqual([]);
    }
  });
});
