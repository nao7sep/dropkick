// @vitest-environment happy-dom

import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Task } from "../../../src/models";
import {
  createDefaultPreferences,
  createDefaultWorkspace,
} from "../../../src/models";
import { TaskDetail } from "../../../src/components/task-detail/TaskDetail";
import { useNoteDraftStore } from "../../../src/state/note-draft-store";
import { usePreferencesStore } from "../../../src/state/preferences-store";
import { useWorkspaceStore } from "../../../src/state/workspace-store";
import { makeNote, makeTask } from "../../helpers/task";
import { mount, type Mounted } from "../../helpers/react-dom";

// A note shows the time of its last content edit beside its text once it has
// been edited; a note never edited, which includes every note written before
// the field existed, shows none.

let host: Mounted | null = null;

function task(): Task {
  return {
    ...makeTask({
      id: "task-a",
      notes: [
        makeNote({ id: "edited", content: "Edited text", editedAtUtc: "2026-10-05T01:02:03.004Z" }),
        makeNote({ id: "plain", content: "Plain text" }),
      ],
    }),
    sourceFile: "/one.json",
    hasActionableNotes: false,
    canComplete: true,
    isOverdue: false,
    isDueToday: false,
    group: "Default",
  };
}

function noteCard(content: string): HTMLElement {
  const text = [...document.querySelectorAll("p")].find((p) => p.textContent === content);
  return text!.parentElement!;
}

beforeEach(async () => {
  usePreferencesStore.setState({
    preferences: { ...createDefaultPreferences("Test"), timezone: "UTC" },
  });
  useWorkspaceStore.setState({ workspace: createDefaultWorkspace("Test") });
  useNoteDraftStore.setState({ drafts: {} });
  host = await mount(
    createElement(TaskDetail, {
      task: task(),
      filePath: "/one.json",
      isUnifiedView: false,
      nextActiveTaskKey: null,
      focusNewNoteSignal: 0,
    }),
  );
});

afterEach(async () => {
  await host?.unmount();
  host = null;
});

describe("note edit time", () => {
  it("shows the edit time beside an edited note's text", () => {
    const card = noteCard("Edited text");
    expect(card.textContent).toMatch(/Edited: .*2026/);
  });

  it("shows nothing for a note never edited", () => {
    expect(noteCard("Plain text").textContent).toBe("Plain text");
  });
});
