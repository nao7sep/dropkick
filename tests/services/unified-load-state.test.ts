import { describe, it, expect } from "vitest";
import { summarizeUnifiedLoadState } from "../../src/services/unified-load-state";

function tab(filePath: string, displayName = filePath, isUnifiedView = false) {
  return { isUnifiedView, filePath, displayName };
}

describe("summarizeUnifiedLoadState", () => {
  it("returns an empty summary for no tabs", () => {
    expect(summarizeUnifiedLoadState([], new Set(), new Set())).toEqual({
      failedNames: [],
      loadingCount: 0,
    });
  });

  it("skips the unified-view tab (it has no file of its own)", () => {
    const tabs = [tab("", "Unified View", true)];
    expect(summarizeUnifiedLoadState(tabs, new Set(), new Set())).toEqual({
      failedNames: [],
      loadingCount: 0,
    });
  });

  it("counts a not-yet-loaded list as loading", () => {
    const tabs = [tab("/a.json", "A")];
    expect(summarizeUnifiedLoadState(tabs, new Set(), new Set())).toEqual({
      failedNames: [],
      loadingCount: 1,
    });
  });

  it("treats a loaded list as neither failed nor loading", () => {
    const tabs = [tab("/a.json", "A")];
    expect(
      summarizeUnifiedLoadState(tabs, new Set(["/a.json"]), new Set()),
    ).toEqual({ failedNames: [], loadingCount: 0 });
  });

  it("reports a failed list by its display name", () => {
    const tabs = [tab("/a.json", "Alpha")];
    expect(
      summarizeUnifiedLoadState(tabs, new Set(), new Set(["/a.json"])),
    ).toEqual({ failedNames: ["Alpha"], loadingCount: 0 });
  });

  it("treats an errored list as failed, never as loading, even if not loaded", () => {
    // A list can be both absent from `files` and present in errors; it must be
    // reported as failed, not double-counted as still loading.
    const tabs = [tab("/a.json", "Alpha")];
    const result = summarizeUnifiedLoadState(tabs, new Set(), new Set(["/a.json"]));
    expect(result.failedNames).toEqual(["Alpha"]);
    expect(result.loadingCount).toBe(0);
  });

  it("summarizes a mix of loaded, loading, and failed lists (unified tab skipped)", () => {
    const tabs = [
      tab("/loaded.json", "Loaded"),
      tab("/loading.json", "Loading"),
      tab("/failed.json", "Failed"),
      tab("", "Unified View", true),
    ];
    const result = summarizeUnifiedLoadState(
      tabs,
      new Set(["/loaded.json"]),
      new Set(["/failed.json"]),
    );
    expect(result.failedNames).toEqual(["Failed"]);
    expect(result.loadingCount).toBe(1);
  });

  it("preserves tab order in failedNames", () => {
    const tabs = [tab("/b.json", "Bravo"), tab("/a.json", "Alpha")];
    const result = summarizeUnifiedLoadState(
      tabs,
      new Set(),
      new Set(["/a.json", "/b.json"]),
    );
    expect(result.failedNames).toEqual(["Bravo", "Alpha"]);
  });
});
