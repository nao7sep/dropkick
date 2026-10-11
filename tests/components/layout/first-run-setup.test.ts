// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, act } from "react";
import { mount, type Mounted } from "../../helpers/react-dom";
const mocks = vi.hoisted(() => ({ open: vi.fn(), create: vi.fn(), register: vi.fn(), showMessage: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../../../src/repositories/first-run", () => ({ getSuggestedSetupDirectory: async () => "/Documents/Dropkick", createInitialDocuments: mocks.create }));
vi.mock("../../../src/state/app-config-store", () => ({ useAppConfigStore: { getState: () => ({ register: mocks.register }) } }));
vi.mock("../../../src/repositories", () => ({ showMessage: mocks.showMessage, log: { warn: vi.fn(), error: vi.fn() }, toErrorFields: () => ({}) }));
import { FirstRunSetup } from "../../../src/components/layout/FirstRunSetup";
let host: Mounted;
const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === label)!;
beforeEach(() => { vi.resetAllMocks(); mocks.register.mockResolvedValue(true); mocks.create.mockResolvedValue({ workspacePath: "/picked/workspace.json" }); });
afterEach(async () => { await host?.unmount(); });
describe("first setup", () => {
  it("suggests Documents/Dropkick without writing, and a cancelled folder picker writes nothing", async () => {
    mocks.open.mockResolvedValue(null);
    host = await mount(createElement(FirstRunSetup, { onLaunch: vi.fn(), onExisting: vi.fn(), onQuit: vi.fn() }));
    expect(document.body.textContent).toContain("/Documents/Dropkick");
    await act(async () => { button("Choose folder…").click(); });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it("uses the chosen folder and waits for creation before registering/opening", async () => {
    const onLaunch = vi.fn();
    mocks.open.mockResolvedValue("/picked");
    host = await mount(createElement(FirstRunSetup, { onLaunch, onExisting: vi.fn(), onQuit: vi.fn() }));
    await act(async () => { button("Choose folder…").click(); });
    await act(async () => { (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    await act(async () => { button("Create and open").click(); });
    expect(mocks.create).toHaveBeenCalledWith("/picked", false, expect.objectContaining({ taskList: "Tasks" }));
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledWith("/picked/workspace.json");
    expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.register.mock.invocationCallOrder[0]);
  });
  it("offers recovery after failure without adopting paths or retrying automatically", async () => {
    mocks.create.mockRejectedValue({ code: "occupied" });
    const onLaunch = vi.fn(); const onExisting = vi.fn();
    host = await mount(createElement(FirstRunSetup, { onLaunch, onExisting, onQuit: vi.fn() }));
    await act(async () => { button("Create and open").click(); });
    expect(onLaunch).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.showMessage).toHaveBeenCalledOnce();
    await act(async () => { button("Use existing files…").click(); });
    expect(onExisting).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledOnce();
  });
});
