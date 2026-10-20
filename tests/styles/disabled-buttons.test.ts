import { describe, expect, it } from "vitest";
import { parseSource, stringTokens, tsxSources, type Source } from "../helpers/tsx-classes";

// Off, a button is the resting button faded: the same fill, outline, ink, padding
// and footprint, so it stays recognisably the control that will come back. The
// filled primary instead replaced its accent with the page background — 1.05:1
// against the panel it sits on in the light theme, 1.18:1 in the dark — so the
// button stopped having a shape at all, and drew identically to a hovered
// secondary beside it. The Button primitive's roles fade in App.css; buttons
// still styled at their call sites are held to the same rule here.

// Disabled-state utilities that replace a fill or an ink, wherever a string in
// the program holds them.
function replacedStates(sources: readonly Source[]): string[] {
  return sources.flatMap(({ file, ast }) =>
    stringTokens(ast)
      .filter(({ token }) => token.includes("disabled:bg-") || token.includes("disabled:text-"))
      .map(({ token, line }) => `${file}:${line}: ${token}`),
  );
}

// Every disabled fade the program uses, by its opacity step.
function fades(sources: readonly Source[]): string[] {
  const steps = new Set<string>();
  for (const { ast } of sources)
    for (const { token } of stringTokens(ast))
      for (const [, value] of token.matchAll(/disabled:opacity-(\d+)/g)) steps.add(value!);
  return [...steps];
}

describe("disabled buttons", () => {
  const sources = tsxSources();

  it("fades a disabled button instead of replacing its fill", () => {
    expect(replacedStates(sources)).toEqual([]);
  });

  it("uses one fade everywhere, so no two disabled buttons recede differently", () => {
    expect(fades(sources)).toEqual(["50"]);
  });

  it("finds a planted replaced fill and a second fade", () => {
    const planted: Source = {
      file: "planted.tsx",
      ast: parseSource(
        [
          'const A = () => <button className="disabled:bg-background disabled:opacity-50">a</button>;',
          'const B = () => <button className={`px-2 ${on ? "disabled:text-ink-muted" : ""} disabled:opacity-40`}>b</button>;',
        ].join("\n"),
        "planted.tsx",
      ),
    };
    expect(replacedStates([planted])).toEqual([
      "planted.tsx:1: disabled:bg-background",
      "planted.tsx:2: disabled:text-ink-muted",
    ]);
    expect(fades([planted])).toEqual(["50", "40"]);
  });
});
