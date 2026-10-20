// Stylesheets read as PostCSS syntax trees for the style tests. A rule's
// selectors, its own declarations and the at-rules around it (`@media`,
// `@layer`, `@theme`) come from the tree, so a comment, a reformatted block or
// a rule nested one level deeper never changes what a test sees.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postcss, { type AtRule, type Declaration, type Node, type Root, type Rule } from "postcss";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));

export function parseCss(source: string, from?: string): Root {
  return postcss.parse(source, { from });
}

// A stylesheet by its path from the repository root.
export function readCss(file: string): Root {
  return parseCss(readFileSync(join(ROOT, file), "utf8"), file);
}

export function appCss(): Root {
  return readCss("src/App.css");
}

// Every rule at any depth, in source order: inside `@media`, `@layer` and
// `@keyframes` included.
export function rulesOf(root: Root): Rule[] {
  const rules: Rule[] = [];
  root.walkRules((rule) => {
    rules.push(rule);
  });
  return rules;
}

// Whitespace and line breaks inside a selector say nothing about it.
export function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, " ").trim();
}

// A rule's whole selector, e.g. ".a, .b".
export function selectorOf(rule: Rule): string {
  return normalizeSelector(rule.selector);
}

// A rule's selector list, split where PostCSS splits it: at top-level commas,
// never inside `:is(...)` or an attribute value.
export function selectorsOf(rule: Rule): string[] {
  return rule.selectors.map(normalizeSelector);
}

// The at-rules a node sits in, outermost first, e.g.
// ["@media (prefers-color-scheme: dark)"] or ["@layer components"].
export function atRulesAround(node: Node): string[] {
  const chain: string[] = [];
  for (let parent = node.parent; parent && parent.type !== "root"; parent = parent.parent) {
    if (parent.type === "atrule") {
      const atRule = parent as AtRule;
      chain.unshift(`@${atRule.name}${atRule.params ? ` ${normalizeSelector(atRule.params)}` : ""}`);
    }
  }
  return chain;
}

// A rule straight under the stylesheet: no media query, layer or other
// at-rule decides whether or how it applies.
export function isUnconditioned(rule: Rule): boolean {
  return rule.parent?.type === "root";
}

// The declarations a rule itself holds, not those of rules nested in it.
export function declarationsOf(rule: Rule): Declaration[] {
  return rule.nodes.filter((node): node is Declaration => node.type === "decl");
}

// A rule's own value for a property: the last declaration wins, as in the
// cascade.
export function declarationValue(rule: Rule, property: string): string | undefined {
  return declarationsOf(rule).filter((decl) => decl.prop === property).at(-1)?.value;
}

// Rules whose selector list holds `selector` as one of its entries.
export function rulesFor(root: Root, selector: string): Rule[] {
  const wanted = normalizeSelector(selector);
  return rulesOf(root).filter((rule) => selectorsOf(rule).includes(wanted));
}

// Rules whose whole selector list is exactly `selectors`, in order.
export function rulesWithSelectors(root: Root, selectors: readonly string[]): Rule[] {
  return rulesOf(root).filter((rule) => {
    const list = selectorsOf(rule);
    return list.length === selectors.length && list.every((s, i) => s === selectors[i]);
  });
}

// Custom properties declared by `rules`, later declarations overriding earlier
// ones as the cascade would for rules of equal weight.
export function customProperties(rules: readonly Rule[]): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const rule of rules)
    for (const decl of declarationsOf(rule)) if (decl.prop.startsWith("--")) tokens.set(decl.prop, decl.value);
  return tokens;
}

// Every custom property's first declaration across `roots`, in order, wherever
// it sits: inside `@theme` blocks and media queries included.
export function firstCustomProperties(...roots: Root[]): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const root of roots)
    root.walkDecls((decl) => {
      if (decl.prop.startsWith("--") && !tokens.has(decl.prop)) tokens.set(decl.prop, decl.value);
    });
  return tokens;
}
