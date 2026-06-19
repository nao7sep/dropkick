import { describe, it, expect } from "vitest";
import { singleLine, multiline } from "../../src/utils/textCleanup";

describe("singleLine", () => {
  it("trims the ends", () => {
    expect(singleLine("  hello  ")).toBe("hello");
  });

  it("flattens line breaks into single spaces by default", () => {
    expect(singleLine("a\nb")).toBe("a b");
  });

  it("flattens a mixed break run into one space", () => {
    expect(singleLine("aaa\n \n\nbbb")).toBe("aaa bbb");
  });

  it("preserves horizontal spacing by default", () => {
    expect(singleLine("a    b")).toBe("a    b");
  });

  it("returns empty for whitespace-only input", () => {
    expect(singleLine("\n\n  \n")).toBe("");
  });

  describe("minify", () => {
    it("collapses runs of horizontal whitespace", () => {
      expect(singleLine("a    b\t\tc", { minify: true })).toBe("a b c");
    });

    it("flattens newlines as well", () => {
      expect(singleLine("a\nb\r\nc", { minify: true })).toBe("a b c");
    });

    it("collapses runs of full-width U+3000", () => {
      expect(singleLine("a　　b", { minify: true })).toBe("a b");
    });

    it("replaces a lone full-width U+3000", () => {
      expect(singleLine("a　b", { minify: true })).toBe("a b");
    });
  });
});

describe("multiline", () => {
  it("trims trailing whitespace on each line", () => {
    expect(multiline("a  \nb  ")).toBe("a\nb");
  });

  it("drops blank lines at the edges but keeps indentation", () => {
    expect(multiline("\n\n  hello  \n\n")).toBe("  hello");
  });

  it("preserves interior blank lines by default", () => {
    expect(multiline("a\n\n\nb")).toBe("a\n\n\nb");
  });

  it("treats a whitespace-only line as blank", () => {
    expect(multiline("a\n   \nb")).toBe("a\n\nb");
  });

  it("normalizes CRLF and CR to LF", () => {
    expect(multiline("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("collapses interior blank runs when asked", () => {
    expect(multiline("a\n\n\nb", { collapseBlankLines: true })).toBe("a\n\nb");
  });

  it("returns empty for all-blank input", () => {
    expect(multiline("   \n   ")).toBe("");
  });
});
