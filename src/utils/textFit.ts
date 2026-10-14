// Display-only shortening of variable text (interface-styling-conventions,
// Labels). Nothing here changes what is stored, logged or passed on.

// How many values a message about several items names before counting the rest.
export const NAMED_FEW = 3;

const ELLIPSIS = "…";

// A name or title keeps its beginning. Counted in code points, so a surrogate
// pair is never split.
export function shortenName(name: string, max = 32): string {
  const chars = Array.from(name);
  if (chars.length <= max) return name;
  return chars.slice(0, max - 1).join("").trimEnd() + ELLIPSIS;
}

// A path keeps its root and its final segment and loses its middle, because
// its beginning is usually shared with every other path shown beside it.
export function shortenPath(path: string, max = 48): string {
  if (Array.from(path).length <= max) return path;
  const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const parts = path.split(/[\\/]/);
  const last = parts[parts.length - 1];
  const head = parts[0] === "" ? separator + (parts[1] ?? "") : parts[0];
  const kept: string[] = [last];
  // Add whole segments from the end while root, ellipsis and tail still fit.
  for (let index = parts.length - 2; index > (parts[0] === "" ? 1 : 0); index -= 1) {
    const candidate = [parts[index], ...kept].join(separator);
    if (Array.from(`${head}${separator}${ELLIPSIS}${separator}${candidate}`).length > max) break;
    kept.unshift(parts[index]);
  }
  const shortened = `${head}${separator}${ELLIPSIS}${separator}${kept.join(separator)}`;
  if (Array.from(shortened).length <= max) return shortened;
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
