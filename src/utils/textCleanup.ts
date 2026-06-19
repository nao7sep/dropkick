// Text cleanup helpers — single-line and multiline whitespace normalization.
// Per the fleet text-cleanup-conventions: cleanup runs at commit/blur/submit/
// save time, never mid-edit (see text-input-ime-conventions). The algorithms
// here are copied verbatim from the verified reference implementation; do not
// rewrite them.

// For scalar values — titles, names, labels, single fields.
//
// - flattenLineBreaks (default true): collapse any whitespace run containing a
//   line break into one ASCII space; pure horizontal spacing within a line is
//   preserved.
// - minify (default false): collapse every run of 1+ whitespace characters
//   (including a lone full-width U+3000) into one ASCII space. Dominates
//   flattenLineBreaks. Always trims the ends.
export function singleLine(
  text: string,
  opts: { flattenLineBreaks?: boolean; minify?: boolean } = {},
): string {
  const { flattenLineBreaks = true, minify = false } = opts;
  if (minify) return text.replace(/\s+/g, " ").trim();
  if (flattenLineBreaks) return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
  return text.trim();
}

// For bodies where line structure matters — notes, descriptions, plain text.
// Indentation is always preserved.
//
// - trimLineEnds (default true): drop each line's trailing whitespace.
// - dropEdgeBlankLines (default true): drop blank lines before the first and
//   after the last visible line.
// - collapseBlankLines (default false): reduce interior runs of blank lines to
//   one. Off by default — an interior blank run is often a deliberate break.
//
// A line is blank when its trimmed form is empty. Newlines (\n, \r, \r\n) are
// normalized to \n on output.
export function multiline(
  text: string,
  opts: { trimLineEnds?: boolean; dropEdgeBlankLines?: boolean; collapseBlankLines?: boolean } = {},
): string {
  const { trimLineEnds = true, dropEdgeBlankLines = true, collapseBlankLines = false } = opts;
  const isBlank = (l: string) => l.trim() === "";
  let lines = text.split(/\r\n|\r|\n/);
  if (trimLineEnds) lines = lines.map((l) => l.replace(/\s+$/, ""));

  let start = 0;
  let end = lines.length;
  if (dropEdgeBlankLines) {
    while (start < end && isBlank(lines[start])) start++;
    while (end > start && isBlank(lines[end - 1])) end--;
  }

  const out: string[] = [];
  let prevBlank = false;
  for (const line of lines.slice(start, end)) {
    const blank = isBlank(line);
    if (collapseBlankLines && blank && prevBlank) continue;
    out.push(line);
    prevBlank = blank;
  }
  return out.join("\n");
}
