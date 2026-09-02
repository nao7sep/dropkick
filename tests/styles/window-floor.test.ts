import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mainWindow = readFileSync(
  fileURLToPath(
    new URL("../../src/components/layout/MainWindow.tsx", import.meta.url),
  ),
  "utf8",
);
const appCss = readFileSync(
  fileURLToPath(new URL("../../src/App.css", import.meta.url)),
  "utf8",
);

describe("main-window height chain", () => {
  it("gives root recovery surfaces a definite viewport height", () => {
    expect(appCss).toMatch(/html,\s*body,\s*#root\s*{[^}]*height:\s*100%/s);
  });

  it("gives the flex stack a definite ordinary viewport height", () => {
    expect(mainWindow).toContain('className="h-screen overflow-auto bg-background"');
    expect(mainWindow).toContain('className="flex h-full min-h-full flex-col"');
    expect(mainWindow).not.toContain('className="flex min-h-full flex-col"');
  });

  it("lets the content row fill below live tab chrome", () => {
    expect(mainWindow).toContain('className="flex min-h-0 flex-1"');
    expect(mainWindow).toContain('className="flex h-full shrink-0 flex-col');
    expect(mainWindow).toContain('className="h-full flex-1 min-w-0');
  });

  it("keeps the complete inner floor inside the overflow viewport", () => {
    expect(mainWindow).toContain("SIDEBAR_MIN_WIDTH + SPLITTER_WIDTH + DETAIL_MIN_WIDTH");
    expect(mainWindow).toContain("minHeight: `${CONTENT_MIN_HEIGHT}px`");
  });
});
