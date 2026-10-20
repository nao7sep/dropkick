// TypeScript and TSX sources read as Babel syntax trees for the style tests.
//
// Two views of the classes a source puts on its elements:
// - classAttributes: each JSX `className` (or a `…ClassName` prop that is
//   forwarded to one), resolved to the class text it can hold — string and
//   template literals, both arms of a condition, and the string constants,
//   lookup objects and local helpers it refers to. Checks about one element's
//   own class list read this.
// - stringsIn: every string literal and template text in the program. Tailwind
//   generates a utility from any string in the source, so a class reaches an
//   element from a constant, a role table or a helper's return as readily as
//   from a className. A check that a class appears nowhere reads this. Comments
//   are not part of the program, so prose that names a class is not a use.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, type ParserPlugin } from "@babel/parser";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));

// A Babel node, kept loose: the tests read a handful of node kinds by field.
export type Ast = { type: string; loc?: { start: { line: number } } | null; [key: string]: any };

export type Source = { file: string; ast: Ast };

const SKIPPED_KEYS = new Set([
  "loc", "start", "end", "range", "extra",
  "leadingComments", "trailingComments", "innerComments", "comments",
]);

export function parseSource(source: string, file: string): Ast {
  const plugins: ParserPlugin[] = /\.[cm]?ts$/.test(file) ? ["typescript"] : ["jsx", "typescript"];
  return parse(source, { sourceType: "module", plugins }).program as Ast;
}

// Files under `dir` (a path from the repository root) whose names pass `test`.
export function filesUnder(dir: string, test: (name: string) => boolean): string[] {
  const walk = (path: string): string[] =>
    readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
      const child = join(path, entry.name);
      if (entry.isDirectory()) return walk(child);
      return test(entry.name) ? [relative(ROOT, child)] : [];
    });
  return walk(join(ROOT, dir));
}

export function readSource(file: string): Source {
  return { file, ast: parseSource(readFileSync(join(ROOT, file), "utf8"), file) };
}

export function tsxSources(dir = "src"): Source[] {
  return filesUnder(dir, (name) => name.endsWith(".tsx")).map(readSource);
}

export function isNode(value: unknown): value is Ast {
  return value !== null && typeof value === "object" && typeof (value as Ast).type === "string";
}

// Visits every node below `node`, each with its ancestors, nearest last.
export function walk(node: Ast, visit: (node: Ast, ancestors: readonly Ast[]) => void): void {
  const ancestors: Ast[] = [];
  const step = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(step);
      return;
    }
    if (!isNode(value)) return;
    visit(value, ancestors);
    ancestors.push(value);
    for (const [key, child] of Object.entries(value)) if (!SKIPPED_KEYS.has(key)) step(child);
    ancestors.pop();
  };
  step(node);
}

export function lineOf(node: Ast): number {
  return node.loc?.start.line ?? 0;
}

// Every string the program holds: string literals and each template's text.
export function stringsIn(node: Ast): Array<{ value: string; line: number }> {
  const found: Array<{ value: string; line: number }> = [];
  walk(node, (current) => {
    if (current.type === "StringLiteral") found.push({ value: current.value, line: lineOf(current) });
    if (current.type === "TemplateElement") found.push({ value: current.value.cooked ?? "", line: lineOf(current) });
  });
  return found;
}

export function classTokens(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

// Every class-like token in every string of the program.
export function stringTokens(node: Ast): Array<{ token: string; line: number }> {
  return stringsIn(node).flatMap(({ value, line }) => classTokens(value).map((token) => ({ token, line })));
}

// A utility's name without its variants: `hover:md:flex` -> `flex`. Colons
// inside an arbitrary value (`[overflow-wrap:anywhere]`) are not variants.
export function utilityOf(token: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token.charAt(i);
    if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth--;
    else if (c === ":" && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!|!$/g, "");
}

// Declarations a class expression can refer to by name: constants, lookup
// objects and local helper functions anywhere in the file.
type Bindings = Map<string, Ast[]>;

function bindingsOf(program: Ast): Bindings {
  const bindings: Bindings = new Map();
  const add = (name: string, node: Ast) => bindings.set(name, [...(bindings.get(name) ?? []), node]);
  walk(program, (node) => {
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && node.init) add(node.id.name, node.init);
    if (node.type === "FunctionDeclaration" && node.id) add(node.id.name, node);
  });
  return bindings;
}

// The class text an expression can produce: every literal piece it may hold,
// joined by spaces, so the union of both arms of a condition is checked.
function classText(expression: Ast | null | undefined, bindings: Bindings, seen: Set<Ast> = new Set()): string {
  if (!expression || seen.has(expression)) return "";
  seen.add(expression);
  const text = (node: Ast | null | undefined) => classText(node, bindings, seen);
  const all = (nodes: Array<Ast | null | undefined>) => nodes.map(text).filter(Boolean).join(" ");
  switch (expression.type) {
    case "StringLiteral":
      return expression.value;
    case "TemplateLiteral":
      return [
        ...expression.quasis.map((quasi: Ast) => quasi.value.cooked ?? ""),
        ...expression.expressions.map(text),
      ].join(" ");
    case "JSXExpressionContainer":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "ParenthesizedExpression":
      return text(expression.expression);
    case "ConditionalExpression":
      return all([expression.consequent, expression.alternate]);
    case "LogicalExpression":
    case "BinaryExpression":
      return all([expression.left, expression.right]);
    case "ArrayExpression":
      return all(expression.elements);
    case "ObjectExpression":
      return all(expression.properties.map((property: Ast) => property.value));
    case "Identifier":
      return all(bindings.get(expression.name) ?? []);
    case "MemberExpression": {
      // `GROUP_CARDS[group]` may be any of the object's values; `X.key` is that
      // one when the object declares it.
      const owner = text(expression.object);
      if (!expression.computed && expression.property.type === "Identifier") {
        const objects = expression.object.type === "Identifier" ? bindings.get(expression.object.name) ?? [] : [];
        const named = objects
          .filter((node) => node.type === "ObjectExpression")
          .flatMap((node) => node.properties)
          .filter((property: Ast) => (property.key?.name ?? property.key?.value) === expression.property.name);
        if (named.length > 0) return all(named.map((property: Ast) => property.value));
      }
      return owner;
    }
    case "CallExpression":
      // A helper's returns and the literal arguments it is given (`cn("a", b)`,
      // `[...].join(" ")`, `` `...`.trim() ``).
      return all([expression.callee, ...expression.arguments]);
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression": {
      if (expression.body.type !== "BlockStatement") return text(expression.body);
      const returns: Ast[] = [];
      walk(expression.body, (node) => {
        if (node.type === "ReturnStatement" && node.argument) returns.push(node.argument);
      });
      return all(returns);
    }
    default:
      return "";
  }
}

export function elementName(opening: Ast): string {
  const name = (node: Ast): string =>
    node.type === "JSXIdentifier"
      ? node.name
      : node.type === "JSXMemberExpression"
        ? `${name(node.object)}.${node.property.name}`
        : `${node.namespace.name}:${node.name.name}`;
  return name(opening.name);
}

export type JsxElement = {
  name: string;
  line: number;
  node: Ast; // the JSXElement
  opening: Ast;
  // Each named attribute's value node; null for a bare attribute (`hidden`).
  attributes: Map<string, Ast | null>;
  // The resolved class text of its className.
  classes: string[];
};

function attributesOf(opening: Ast): Map<string, Ast | null> {
  const attributes = new Map<string, Ast | null>();
  for (const attribute of opening.attributes)
    if (attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier")
      attributes.set(attribute.name.name, attribute.value);
  return attributes;
}

export function jsxElements(program: Ast): JsxElement[] {
  const bindings = bindingsOf(program);
  const elements: JsxElement[] = [];
  walk(program, (node) => {
    if (node.type !== "JSXElement") return;
    const attributes = attributesOf(node.openingElement);
    elements.push({
      name: elementName(node.openingElement),
      line: lineOf(node),
      node,
      opening: node.openingElement,
      attributes,
      classes: classTokens(classText(attributes.get("className"), bindings)),
    });
  });
  return elements;
}

export type ClassAttribute = { element: string; attribute: string; line: number; text: string; tokens: string[] };

// Every `className` and `…ClassName` attribute, resolved to its class text.
export function classAttributes(program: Ast): ClassAttribute[] {
  const bindings = bindingsOf(program);
  const found: ClassAttribute[] = [];
  walk(program, (node) => {
    if (node.type !== "JSXOpeningElement") return;
    for (const attribute of node.attributes) {
      if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier") continue;
      const name: string = attribute.name.name;
      if (name !== "className" && !name.endsWith("ClassName")) continue;
      const text = classText(attribute.value, bindings);
      found.push({ element: elementName(node), attribute: name, line: lineOf(attribute), text, tokens: classTokens(text) });
    }
  });
  return found;
}

// The class text an arbitrary expression in `program` resolves to, e.g. an
// object's `className` property.
export function resolvedClasses(program: Ast, expression: Ast | null | undefined): string[] {
  return classTokens(classText(expression, bindingsOf(program)));
}

// An attribute's string value: `a="x"`, `a={"x"}` or `` a={`x`} `` with no
// interpolation. Anything computed is undefined.
export function attributeString(value: Ast | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value.type === "StringLiteral") return value.value;
  if (value.type === "JSXExpressionContainer") return attributeString(value.expression);
  if (value.type === "TemplateLiteral" && value.expressions.length === 0) return value.quasis[0].value.cooked;
  return undefined;
}

// An element's own text: its JSXText children, trimmed and joined.
export function elementText(element: JsxElement): string {
  return element.node.children
    .filter((child: Ast) => child.type === "JSXText")
    .map((child: Ast) => child.value.trim())
    .filter(Boolean)
    .join(" ");
}

// The translation keys an element shows: `t("key")` calls among its children.
export function translationKeys(element: JsxElement): string[] {
  const keys: string[] = [];
  for (const child of element.node.children)
    walk(child, (node) => {
      if (
        node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        node.callee.name === "t" &&
        node.arguments[0]?.type === "StringLiteral"
      )
        keys.push(node.arguments[0].value);
    });
  return keys;
}

// The function or variable declaration named `name` in `program`.
export function declarationNamed(program: Ast, name: string): Ast | undefined {
  let found: Ast | undefined;
  walk(program, (node) => {
    if (found) return;
    if (node.type === "FunctionDeclaration" && node.id?.name === name) found = node;
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && node.id.name === name) found = node;
  });
  return found;
}
