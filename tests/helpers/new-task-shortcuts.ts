import { act, createElement } from "react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { NewTaskModal } from "../../src/components/layout/NewTaskModal";
import { createDefaultSettings, createDefaultWorkspace, createTab } from "../../src/models";
import { useSettingsStore } from "../../src/state/settings-store";
import { useWorkspaceStore } from "../../src/state/workspace-store";
import { useTaskListStore } from "../../src/state/task-list-store";
import { todayInTimezone, tomorrowInTimezone } from "../../src/utils";
import { mount, type Mounted } from "./react-dom";

// Call from platform-specific specs whose hoisted setup precedes these imports.
export function newTaskShortcutCases(Modal: typeof NewTaskModal, platform: "mac" | "windows") {
  let host: Mounted | null = null;

  afterEach(async () => {
    await host?.unmount();
    host = null;
  });
  afterAll(() => { vi.unstubAllGlobals(); });

  const chords = platform === "mac"
    ? [{ modifier: "Control", applies: false }, { modifier: "Command", applies: true }]
    : [{ modifier: "Control", applies: true }];

  describe.each(chords)(`New Task ${platform} $modifier date shortcuts`, ({ modifier, applies }) => {
    it.each([
      ["d", 0], ["t", 0], ["n", 0],
      ["d", 1], ["t", 1], ["n", 1],
    ] as const)("handles %s in editable field %i", async (key, fieldIndex) => {
      useWorkspaceStore.setState({ workspace: { ...createDefaultWorkspace("Test"), openTabs: [createTab("/one.json", "One")] } });
      useSettingsStore.setState({ settings: { ...createDefaultSettings(), timezone: "UTC" } });
      const addNewTask = vi.fn(async () => ({ status: "success" as const }));
      useTaskListStore.setState({ addNewTask });
      host = await mount(createElement(Modal, { currentFilePath: "/one.json", isUnifiedView: false, onClose: () => undefined }));

      const labels = [...document.querySelectorAll<HTMLLabelElement>("label")];
      expect(labels).toHaveLength(5);
      expect(labels.map((label) => label.control?.tagName)).toEqual(["SELECT", "TEXTAREA", "TEXTAREA", "SELECT", "BUTTON"]);
      expect(new Set(labels.map((label) => label.control)).size).toBe(5);
      const fields = document.querySelectorAll<HTMLTextAreaElement>("textarea");
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(fields[0], "Pay invoice");
        fields[0]!.dispatchEvent(new Event("input", { bubbles: true }));
      });

      // Start from a different date so a swallowed clear or reassignment is visible.
      const seedKey = key === "d" ? "t" : "d";
      await act(async () => {
        fields[fieldIndex]!.dispatchEvent(new KeyboardEvent("keydown", { key: seedKey, metaKey: true, bubbles: true, cancelable: true }));
      });
      const event = new KeyboardEvent("keydown", {
        key,
        ctrlKey: modifier === "Control",
        metaKey: modifier === "Command",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => { fields[fieldIndex]!.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(applies);

      const today = todayInTimezone("UTC");
      const tomorrow = tomorrowInTimezone("UTC");
      const dueDate = applies ? (key === "d" ? today : key === "t" ? tomorrow : null) : (seedKey === "d" ? today : tomorrow);
      await act(async () => {
        [...document.querySelectorAll("button")].find((button) => button.textContent === "Create")!.click();
      });
      expect(addNewTask).toHaveBeenCalledExactlyOnceWith("/one.json", expect.objectContaining({ dueDate }));
    });
  });
}
