// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "../../src/components/shared/AppErrorBoundary";
import { log } from "../../src/repositories";

vi.mock("../../src/repositories", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/repositories")>();
  return {
    ...original,
    log: { ...original.log, error: vi.fn() },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function BrokenView(): never {
  throw new Error("IPC EACCES /private/tmp/render sentinel", {
    cause: new TypeError("root cause sentinel"),
  });
}

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("main-window render failure", () => {
  it("retains an actionable Reload control", async () => {
    const reload = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        React.createElement(
          AppErrorBoundary,
          { onReload: reload, children: React.createElement(BrokenView) },
        ),
      );
    });

    const button = host.querySelector("button");
    expect(button?.textContent).toBe("Reload");
    button?.click();
    expect(reload).toHaveBeenCalledOnce();
    expect(host.textContent).not.toContain("render sentinel");
    expect(host.textContent).not.toContain("EACCES");
    expect(log.error).toHaveBeenCalledWith(
      "renderer view failed",
      expect.objectContaining({
        error: expect.objectContaining({
          message: expect.stringContaining("EACCES"),
          cause: expect.objectContaining({ message: "root cause sentinel" }),
        }),
      }),
    );
  });
});
