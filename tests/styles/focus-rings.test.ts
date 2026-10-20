// @vitest-environment node
//
// The ring belongs to what the key acts on (composite-control-conventions). A
// container that holds focus on its items' behalf — a list with an active row, a
// scroll region, a modal body — draws no ring of its own, because
// `:focus-visible` is no guard for it: any key pressed after a click turns it on,
// and since Safari 27 so does focus a script moves after keyboard use. The task
// list outlined the whole left pane that way the moment D was pressed on a task.
//
// Every place this app makes something focusable is found here from the syntax
// trees, not from memory, and each has to be one of three things: a control or
// item, which may ring; a container the covering rule in App.css reaches; or a
// site listed below with the reason it is neither. A new one that is none of
// these fails.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Root, Rule } from "postcss";
import { describe, expect, it } from "vitest";
import { declarationsOf, isUnconditioned, parseCss, readCss, rulesOf, selectorOf, selectorsOf } from "../helpers/css-tree";
import {
  attributeString,
  elementName,
  filesUnder,
  parseSource,
  resolvedClasses,
  ROOT,
  stringsIn,
  walk,
  type Ast,
} from "../helpers/tsx-classes";

const SOURCE_DIR = "src";
const COVERING_STYLESHEET = "src/App.css";

// Focus sites the tree alone cannot place, and why each is not a ringing container.
// Each entry covers only the one kind of site it explains, so anything else added
// to the same file is still placed on its own merits.
const EXPLAINED: Record<string, { kind: Site["kind"]; reason: string }> = {
  "src/components/shared/Toolbar.tsx": {
    kind: "dom",
    reason: "the toolbar's roving tab stop, set through the DOM on its own buttons",
  },
};

// A composite that owns its items, or a region that scrolls on their behalf.
const CONTAINER_ROLES = [
  "listbox", "tree", "grid", "treegrid", "region", "tabpanel",
  "dialog", "alertdialog", "document", "log",
  "radiogroup", "tablist", "menu", "menubar", "toolbar",
];
const ITEM_ROLES = [
  "option", "tab", "treeitem", "row", "gridcell", "menuitem", "menuitemradio",
  "menuitemcheckbox", "radio", "checkbox", "switch", "button", "link",
  "separator", "slider", "spinbutton", "textbox", "combobox",
];
const CONTROL_TAGS = ["button", "a", "input", "select", "textarea", "summary"];

// A hidden outline, in the places a site can say so: Tailwind's two spellings
// (`outline-none`, and v4's `outline-hidden`, which keeps a transparent one for
// forced-colors mode) and an inline style.
const OUTLINE_OFF = /^(focus:|focus-visible:)?outline-(none|hidden)\b/;
const CONTAINER_RING = /^(focus:|focus-visible:)(ring\b|ring-(?!0\b)|outline-(?!(none|hidden|0)\b))/;

// What a site says about the element it makes focusable. `context` locates it
// in a failure message.
type Site = {
  file: string;
  line: number;
  kind: "attribute" | "object" | "dom";
  tag?: string;
  role?: string;
  classes: string[];
  passiveScroll: boolean;
  inlineOutlineOff: boolean;
  context: string;
};

// An `outline: "none"` anywhere in a site's own props or style object.
function hasInlineOutlineOff(node: Ast): boolean {
  let off = false;
  walk(node, (inner) => {
    if (
      inner.type === "ObjectProperty" &&
      (inner.key.name ?? inner.key.value) === "outline" &&
      inner.value.type === "StringLiteral" &&
      /^none\b/.test(inner.value.value)
    )
      off = true;
  });
  return off;
}

const keyOf = (property: Ast): string | undefined => property.key?.name ?? property.key?.value;

function programSites(source: string, file: string): Site[] {
  const program = parseSource(source, file);
  const sites: Site[] = [];
  walk(program, (node) => {
    // <div tabIndex={0} ...>: the site is the element its opening tag describes.
    if (node.type === "JSXOpeningElement") {
      const attributes = new Map<string, Ast | null>();
      let line = 0;
      for (const attribute of node.attributes)
        if (attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier") {
          attributes.set(attribute.name.name, attribute.value);
          if (/^tab[Ii]ndex$/.test(attribute.name.name)) line = attribute.loc?.start.line ?? 0;
        }
      if (!attributes.has("tabIndex") && !attributes.has("tabindex")) return;
      sites.push({
        file,
        line,
        kind: "attribute",
        tag: elementName(node),
        role: attributeString(attributes.get("role")),
        classes: resolvedClasses(program, attributes.get("className") ?? attributes.get("class")),
        passiveScroll: attributes.has("data-passive-scroll-region"),
        inlineOutlineOff: hasInlineOutlineOff(node),
        context: `<${elementName(node)}>`,
      });
    }
    // { tabIndex: 0, ... }: props spread onto an element; the site is the object.
    if (node.type === "ObjectExpression") {
      const properties = new Map<string, Ast>();
      let line = 0;
      for (const property of node.properties)
        if (property.type === "ObjectProperty" && keyOf(property) !== undefined) {
          properties.set(keyOf(property)!, property.value);
          if (keyOf(property) === "tabIndex") line = property.loc?.start.line ?? 0;
        }
      if (!properties.has("tabIndex")) return;
      sites.push({
        file,
        line,
        kind: "object",
        role: attributeString(properties.get("role")),
        classes: resolvedClasses(program, properties.get("className")),
        passiveScroll: properties.has("data-passive-scroll-region"),
        inlineOutlineOff: hasInlineOutlineOff(node),
        context: "{ tabIndex }",
      });
    }
    // element.tabIndex = …, or element.setAttribute("tabindex", …): set through the DOM.
    const domAssignment =
      node.type === "AssignmentExpression" &&
      node.left.type === "MemberExpression" &&
      !node.left.computed &&
      node.left.property.name === "tabIndex";
    const domAttribute =
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      node.callee.property.name === "setAttribute" &&
      node.arguments[0]?.type === "StringLiteral" &&
      node.arguments[0].value.toLowerCase() === "tabindex";
    if (domAssignment || domAttribute) {
      sites.push({
        file,
        line: node.loc?.start.line ?? 0,
        kind: "dom",
        classes: [],
        passiveScroll: false,
        inlineOutlineOff: false,
        context: "DOM",
      });
    }
  });
  // A page written out as a string — a startup or message window built in
  // code — carries its markup in the program's strings.
  return [...sites, ...stringsIn(program).flatMap(({ value, line }) => markupSites(value, file, line))];
}

// Markup has no parser in this toolchain, so an .html page, or one held in a
// string, is read as text: each opening tag that sets a tabindex, and its
// attributes.
function markupSites(html: string, file: string, firstLine = 1): Site[] {
  return [...html.matchAll(/<([A-Za-z][\w-]*)\b([^>]*)>/g)].flatMap((match) => {
    const attributes = new Map<string, string>();
    for (const [, name, value] of match[2]!.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g))
      attributes.set(name!.toLowerCase(), value ?? "");
    if (!attributes.has("tabindex")) return [];
    return [{
      file,
      line: firstLine + html.slice(0, match.index).split("\n").length - 1,
      kind: "attribute" as const,
      tag: match[1]!.toLowerCase(),
      role: attributes.get("role"),
      classes: (attributes.get("class") ?? "").split(/\s+/).filter(Boolean),
      passiveScroll: attributes.has("data-passive-scroll-region"),
      inlineOutlineOff: /outline\s*:\s*none\b/.test(attributes.get("style") ?? ""),
      context: match[0].slice(0, 120),
    }];
  });
}

// The <style> blocks of a page's markup.
function styleBlocks(html: string): string[] {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? "");
}

// Plain class names only, so a stylesheet rule that rings a container by class —
// not by role — is caught as well.
function plainClasses(site: Site): string[] {
  return site.classes.filter((name) => /^[A-Za-z_][\w-]*$/.test(name));
}

// The element each selector in a list actually styles: its last compound, after
// any combinator. Focus on a container may still paint its active row —
// `[role="listbox"]:focus-visible .row` styles the row — so only a selector whose
// subject is itself a focused container counts against it. PostCSS splits the
// list; a selector itself is a string to it, so its compounds are split here.
function subjects(rule: Rule): string[] {
  return selectorsOf(rule).map((s) => {
    let level = 0;
    let last = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charAt(i);
      if (c === "(" || c === "[") level++;
      else if (c === ")" || c === "]") level--;
      else if (level === 0 && /[\s>+~]/.test(c)) last = i + 1;
    }
    return s.slice(last).trim();
  });
}

const FOCUSED = /:focus(-visible)?(?![\w-])/;

function outlineOff(rule: Rule): boolean {
  return declarationsOf(rule).some((decl) => decl.prop === "outline" && /^none\b/.test(decl.value));
}

// Whether a rule paints something around its element: an outline that is not
// switched off, or a box shadow, which is how ring utilities draw.
function draws(rule: Rule): boolean {
  return declarationsOf(rule).some((decl) => {
    const name = decl.prop.toLowerCase();
    const value = decl.value.trim().toLowerCase();
    if (!value) return false;
    if (name === "outline" || name === "outline-style") return !/^(none|0)\b/.test(value);
    if (name === "outline-width") return !/^0(px)?$/.test(value);
    if (name === "box-shadow") return value !== "none";
    return false;
  });
}

// A plain-CSS app turns an outline off by class, in a stylesheet, rather than
// with a utility on the element: a focus rule whose subject is one of the site's
// own classes and whose outline is none.
function suppressedByClass(site: Site, rules: readonly Rule[]): boolean {
  const classes = plainClasses(site);
  return rules.some(
    (rule) =>
      outlineOff(rule) &&
      subjects(rule).some(
        (subject) =>
          FOCUSED.test(subject) && classes.some((name) => new RegExp(`\\.${name}(?![\\w-])`).test(subject)),
      ),
  );
}

type Placement = "control" | "covered" | "suppressed" | "explained" | undefined;

function placement(site: Site, rules: readonly Rule[]): Placement {
  if (site.kind !== "dom") {
    if (site.tag && CONTROL_TAGS.includes(site.tag)) return "control";
    if (site.role && ITEM_ROLES.includes(site.role)) return "control";
    if (site.role && CONTAINER_ROLES.includes(site.role)) return "covered";
    if (site.passiveScroll) return "covered";
    if (site.inlineOutlineOff || site.classes.some((token) => OUTLINE_OFF.test(token))) return "suppressed";
    if (suppressedByClass(site, rules)) return "suppressed";
  }
  return EXPLAINED[site.file]?.kind === site.kind ? "explained" : undefined;
}

const isContainer = (place: Placement) => place === "covered" || place === "suppressed";

// A container's own ring utilities.
function ringUtilities(site: Site): string[] {
  return site.classes.filter((token) => CONTAINER_RING.test(token));
}

// Focus rules that draw on a container, by its role or by one of its classes.
function drawingOnContainers(rules: readonly Rule[], containerClasses: readonly string[]): string[] {
  const byClass = containerClasses.length ? `|\\.(${containerClasses.join("|")})(?![\\w-])` : "";
  const containerSelector = new RegExp(
    `\\[role="(${CONTAINER_ROLES.join("|")})"\\]|\\[data-passive-scroll-region\\]${byClass}`,
  );
  return rules
    .filter(draws)
    .filter((rule) => subjects(rule).some((subject) => FOCUSED.test(subject) && containerSelector.test(subject)))
    .map(selectorOf);
}

// Each scanned file's sites, and the stylesheets that page carries itself.
const scanned = [
  ...filesUnder(SOURCE_DIR, (name) => /\.(tsx?|jsx?)$/.test(name) && !/\.(test|spec)\./.test(name)).map((file) => {
    const text = readFileSync(join(ROOT, file), "utf8");
    const own = stringsIn(parseSource(text, file)).flatMap(({ value }) => styleBlocks(value));
    return { file, sites: programSites(text, file), ownStyles: own };
  }),
  ...filesUnder(SOURCE_DIR, (name) => name.endsWith(".html")).map((file) => {
    const text = readFileSync(join(ROOT, file), "utf8");
    return { file, sites: markupSites(text, file), ownStyles: styleBlocks(text) };
  }),
];
const sites = scanned.flatMap((entry) => entry.sites);

// A page written out as a string never loads the app's stylesheet. Its own
// <style>, if it has one, is what reaches its containers.
function ownStyle(file: string): Root | undefined {
  const blocks = scanned.find((entry) => entry.file === file)?.ownStyles ?? [];
  return blocks.length ? parseCss(blocks.join("\n")) : undefined;
}

const stylesheet = readCss(COVERING_STYLESHEET);

// Every stylesheet the app has, and every page that carries its own: a ring can
// come from any of them, and so can the rule that turns one off.
const everyRule = [
  ...filesUnder(SOURCE_DIR, (name) => name.endsWith(".css")).map(readCss),
  ...scanned.flatMap(({ file }) => ownStyle(file) ?? []),
].flatMap(rulesOf);

const where = (site: Site) => `${site.file}:${site.line} ${site.context}`;

describe("focus rings belong to what the key acts on", () => {
  it("finds this app's focus sites at all", () => {
    // A scan that silently stopped finding sites would pass every check below.
    expect(sites.length).toBeGreaterThan(3);
  });

  it("places every focus site as a control, a covered container, or an explained exception", () => {
    expect(sites.filter((site) => placement(site, everyRule) === undefined).map(where)).toEqual([]);
  });

  it("explains only sites that still exist", () => {
    const explained = new Set(
      sites.filter((site) => placement(site, everyRule) === "explained").map((site) => site.file),
    );
    expect(Object.keys(EXPLAINED).filter((file) => !explained.has(file))).toEqual([]);
  });

  it("gives no container a ring utility of its own", () => {
    const ringed = sites
      .filter((site) => isContainer(placement(site, everyRule)))
      .filter((site) => ringUtilities(site).length > 0)
      .map(where);
    expect(ringed).toEqual([]);
  });

  it("covers the containers of a page that carries its own stylesheet, in that stylesheet", () => {
    const uncovered = sites
      .filter((site) => placement(site, everyRule) === "covered")
      .filter((site) => ownStyle(site.file) !== undefined)
      .filter((site) => {
        const key = site.role ? `[role="${site.role}"]` : "[data-passive-scroll-region]";
        return !rulesOf(ownStyle(site.file)!).some(
          (rule) => selectorOf(rule).includes(key) && selectorOf(rule).includes(":focus-visible") && outlineOff(rule),
        );
      })
      .map(where);
    expect(uncovered).toEqual([]);
  });

  it("turns the outline off for every container role in one unlayered rule", () => {
    const covering = rulesOf(stylesheet).find(
      (rule) =>
        selectorOf(rule).startsWith(":is(") && selectorOf(rule).endsWith(":focus-visible") && outlineOff(rule),
    );
    expect(covering, "the covering rule is missing").toBeDefined();
    // Unlayered, so it outranks the utilities layer.
    expect(isUnconditioned(covering!), "the covering rule sits inside an at-rule").toBe(true);
    for (const role of CONTAINER_ROLES) {
      expect(selectorOf(covering!)).toContain(`[role="${role}"]`);
    }
    expect(selectorOf(covering!)).toContain("[data-passive-scroll-region]");
  });

  it("lets no other focus rule draw on a container, by role or by class", () => {
    const containerClasses = [
      ...new Set(sites.filter((site) => isContainer(placement(site, everyRule))).flatMap(plainClasses)),
    ];
    expect(drawingOnContainers(everyRule, containerClasses)).toEqual([]);
  });
});

describe("the focus-site scan", () => {
  it("finds a site in each form a program sets one, and none in a comment", () => {
    const planted = [
      "// <div tabIndex={-1}> in prose is not a site",
      "const props = { role: 'region', tabIndex: 0 };",
      "el.tabIndex = 0;",
      "el.setAttribute('tabindex', '0');",
      "const A = () => <div tabIndex={0} />;",
      "const page = `<section tabindex=\"0\"></section>`;",
    ].join("\n");
    expect(programSites(planted, "planted.tsx").map(({ kind, line }) => `${kind}:${line}`)).toEqual([
      "object:2",
      "dom:3",
      "dom:4",
      "attribute:5",
      "attribute:6",
    ]);
  });

  it("leaves a planted plain focusable element unplaced", () => {
    const [site] = programSites('const A = () => <div tabIndex={0} className="p-2" />;', "planted.tsx");
    expect(placement(site!, everyRule)).toBeUndefined();
  });

  it("flags a planted container that rings itself", () => {
    const CLASSES = "focus:outline-none focus-visible:ring-2";
    const source = `const C = ${JSON.stringify(CLASSES)};\nconst A = () => <div role="listbox" tabIndex={0} className={C} />;`;
    const [site] = programSites(source, "planted.tsx");
    expect(placement(site!, everyRule)).toBe("covered");
    expect(ringUtilities(site!)).toEqual(["focus-visible:ring-2"]);
  });

  it("flags a planted focus rule that draws on a container", () => {
    const planted = rulesOf(
      parseCss(`
        [role="listbox"]:focus-visible .row { box-shadow: 0 0 0 2px red; }
        @layer components { .pane:focus-visible, [role="tree"]:focus { outline: 2px solid red; } }
      `),
    );
    expect(drawingOnContainers(planted, ["pane"])).toEqual(['.pane:focus-visible, [role="tree"]:focus']);
  });
});
