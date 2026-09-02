// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const natives = vi.hoisted(() => ({ openUrl: vi.fn(), getVersion: vi.fn(async () => "0.1.0") }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: natives.openUrl }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: natives.getVersion }));
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
    natives.openUrl.mockRejectedValueOnce(
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

    expect(document.body.textContent).toContain("GitHub not opened");
    expect(document.body.textContent).toContain("Open the project page in your browser and try again.");
    expect(document.body.textContent).not.toContain("GitHub could not be opened");
    expect(document.body.textContent).not.toContain("EACCES");
    expect(document.body.textContent).not.toContain("/private/tmp");
    expect(document.body.textContent).not.toContain("HOSTILE-SENTINEL");
    expect(document.body.textContent).not.toContain("IPC");
  });

  it("keeps link results independent and ignores an older same-link failure", async () => {
    let rejectOlder!: (error: unknown) => void;
    natives.openUrl
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOlder = reject; }))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("issues unavailable"));
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(React.createElement(AboutModal, { onClose: vi.fn() })));
    const buttons = Array.from(document.body.querySelectorAll("button"));
    const github = buttons.find((button) => button.textContent?.includes("GitHub"));
    const issues = buttons.find((button) => button.textContent?.includes("Report Issue"));

    await act(async () => { github?.click(); github?.click(); });
    await act(async () => rejectOlder(new Error("stale EACCES /private/tmp/STALE")));
    expect(document.body.textContent).not.toContain("GitHub not opened");

    await act(async () => issues?.click());
    expect(document.body.textContent).toContain("Report Issue not opened");
    expect(document.body.textContent).toContain("Open the issues page in your browser and try again.");
    expect(document.body.textContent).not.toContain("Report Issue could not be opened");
  });

  it("shows an authored stable fact when the app version cannot be read", async () => {
    natives.getVersion.mockRejectedValueOnce(new Error("EACCES /private/tmp/VERSION-SENTINEL"));
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(React.createElement(AboutModal, { onClose: vi.fn() })));

    expect(document.body.textContent).toContain("Version unavailable");
    expect(document.body.textContent).not.toContain("VERSION-SENTINEL");
  });
});
