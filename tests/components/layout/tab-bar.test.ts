import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(
    new URL("../../../src/components/layout/TabBar.tsx", import.meta.url),
  ),
  "utf8",
);

describe("tab bar layout contract", () => {
  it("keeps one fixed chrome row and scrolls only the tablist horizontally", () => {
    expect(source).toContain(
      'className="flex shrink-0 items-center border-b border-border bg-surface"',
    );
    expect(source).toContain("style={{ height: TAB_BAR_MIN_HEIGHT }}");
    expect(source).toContain(
      'className="flex h-full min-w-0 shrink overflow-x-auto overflow-y-hidden"',
    );
    expect(source).not.toContain("flex-wrap");
  });

  it("keeps action menus outside the scrolling tablist", () => {
    const tablist = source.indexOf('role="tablist"');
    const tablistEnd = source.indexOf(
      "\n          </div>\n\n          {/* New-list menu */}",
      tablist,
    );
    const newList = source.indexOf('aria-label="New or open task list"');
    const appMenu = source.indexOf('aria-label="Menu"');

    expect(tablist).toBeGreaterThan(-1);
    expect(tablistEnd).toBeGreaterThan(tablist);
    expect(newList).toBeGreaterThan(tablistEnd);
    expect(appMenu).toBeGreaterThan(newList);
  });

  it("minimally reveals the active tab when activation changes", () => {
    expect(source).toMatch(
      /tabElementAt\(activeTabIndex\)\?\.scrollIntoView\(\{[\s\S]*?block: "nearest",[\s\S]*?inline: "nearest",/,
    );
  });
});
