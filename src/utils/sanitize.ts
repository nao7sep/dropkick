// Text sanitization for user input.

// Collapses newlines and excess whitespace into single spaces, then trims.
// Use for single-line fields like task titles and tab names.
export function sanitizeSingleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}
