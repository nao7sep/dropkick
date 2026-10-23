// @vitest-environment happy-dom

import { vi } from "vitest";

// Platform detection runs when the real shortcut module is first imported.
vi.hoisted(() => {
  vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "MacIntel" });
});

import { NewTaskModal } from "../../../src/components/layout/NewTaskModal";
import { newTaskShortcutCases } from "../../helpers/new-task-shortcuts";

newTaskShortcutCases(NewTaskModal, "mac");
