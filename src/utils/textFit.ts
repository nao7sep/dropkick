// Display-only shortening of variable text (interface-styling-conventions,
// Labels). Nothing here changes what is stored, logged or passed on.

// How many values a message about several items names before counting the rest.
export const NAMED_FEW = 3;

const ELLIPSIS = "…";

// East Asian wide and fullwidth characters take about two columns.
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;

// Columns a string takes, so a limit holds for Japanese as for English.
export function textColumns(text: string): number {
  let columns = 0;
  for (const char of text) columns += WIDE.test(char) ? 2 : 1;
  return columns;
}

// A name or title keeps its beginning. `max` counts columns, and a character
// outside the basic plane is never split.
export function shortenName(name: string, max = 32): string {
  if (textColumns(name) <= max) return name;
  let kept = "";
  let columns = 0;
  for (const char of name) {
    const width = WIDE.test(char) ? 2 : 1;
    if (columns + width > max - 1) break;
    kept += char;
    columns += width;
  }
  return kept.trimEnd() + ELLIPSIS;
}

// A path keeps its root and its final segment and loses its middle, because
// its beginning is usually shared with every other path shown beside it.
export function shortenPath(path: string, max = 48): string {
  if (textColumns(path) <= max) return path;
  const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const parts = path.split(/[\\/]/);
  const last = parts[parts.length - 1];
  const head = parts[0] === "" ? separator + (parts[1] ?? "") : parts[0];
  const kept: string[] = [last];
  // Add whole segments from the end while root, ellipsis and tail still fit.
  for (let index = parts.length - 2; index > (parts[0] === "" ? 1 : 0); index -= 1) {
    const candidate = [parts[index], ...kept].join(separator);
    if (textColumns(`${head}${separator}${ELLIPSIS}${separator}${candidate}`) > max) break;
    kept.unshift(parts[index]);
  }
  const shortened = `${head}${separator}${ELLIPSIS}${separator}${kept.join(separator)}`;
  if (textColumns(shortened) <= max) return shortened;
  // Even the final segment alone is too long: it is what identifies the file,
  // so it stays, shortened like a name.
  return `${ELLIPSIS}${separator}${shortenName(last, Math.max(8, max - 2))}`;
}

// A message about several items names a few, each shortened, then counts the
// rest; the complete list stays reachable where the items themselves are.
export function nameFew(
  names: readonly string[],
  format: { list: (items: readonly string[]) => string; more: (count: number) => string },
  limit = NAMED_FEW,
): string {
  const shown = names.slice(0, limit).map((name) => shortenName(name));
  const rest = names.length - shown.length;
  return format.list(rest > 0 ? [...shown, format.more(rest)] : shown);
}

// The folder a file sits in, for a line under the file's own name.
export function parentFolder(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (cut < 0) return "";
  return cut === 0 ? path.slice(0, 1) : path.slice(0, cut);
}
