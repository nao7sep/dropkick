// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const opener = vi.hoisted(() => ({ openUrl: vi.fn() }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: opener.openUrl }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.1.0") }));
vi.mock("../../src/repositories", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/repositories")>();
  return { ...original, log: { ...original.log, warn: vi.fn() } };
});

import { AboutModal } from "../../src/components/layout/AboutModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("about links", () => {
  it("retains authored copy when the native opener rejects", async () => {
    opener.openUrl.mockRejectedValueOnce(
      new TypeError("EACCES /private/tmp/HOSTILE-SENTINEL IPC"),
    );
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(React.createElement(AboutModal, { onClose: vi.fn() }));
    });
    const github = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("GitHub"),
    );
    await act(async () => github?.click());

    expect(document.body.textContent).toContain("Link not opened");
    expect(document.body.textContent).not.toContain("EACCES");
    expect(document.body.textContent).not.toContain("/private/tmp");
    expect(document.body.textContent).not.toContain("HOSTILE-SENTINEL");
    expect(document.body.textContent).not.toContain("IPC");
  });
});
