import { describe, it, expect } from "vitest";
import { sanitizeSingleLine } from "./sanitize";

describe("sanitizeSingleLine", () => {
  it("collapses newlines into single spaces", () => {
    expect(sanitizeSingleLine("a\nb\r\nc")).toBe("a b c");
  });

  it("collapses runs of whitespace", () => {
    expect(sanitizeSingleLine("a    b\t\tc")).toBe("a b c");
  });

  it("trims leading and trailing whitespace", () => {
    expect(sanitizeSingleLine("   hello   ")).toBe("hello");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(sanitizeSingleLine("  \n\t ")).toBe("");
  });

  it("leaves a clean single-line string unchanged", () => {
    expect(sanitizeSingleLine("already clean")).toBe("already clean");
  });
});
