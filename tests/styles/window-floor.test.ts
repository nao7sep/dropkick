import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mainWindow = readFileSync(
  fileURLToPath(
    new URL("../../src/components/layout/MainWindow.tsx", import.meta.url),
  ),
  "utf8",
);

describe("scaled content floor", () => {
  it("stays inside a scroll-owning viewport when the native floor is capped", () => {
    expect(mainWindow).toContain('className="h-screen overflow-auto bg-background"');
    expect(mainWindow).toContain("SIDEBAR_MIN_WIDTH + SPLITTER_WIDTH + DETAIL_MIN_WIDTH");
    expect(mainWindow).toContain("minHeight: `${CONTENT_MIN_HEIGHT}px`");
  });
});
