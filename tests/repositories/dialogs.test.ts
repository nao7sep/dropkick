import { describe, it, expect, beforeEach, vi } from "vitest";

// The save panel and the file-existence check are the two side effects here.
const save = vi.fn();
const fileExists = vi.fn();
const showAppConfirm = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: (opts: unknown) => save(opts),
}));
vi.mock("../../src/repositories/file-system", () => ({
  fileExists: (p: string) => fileExists(p),
}));
vi.mock("../../src/state/dialog-store", () => ({
  showAppConfirm: (t: string, b: string, o: unknown) => showAppConfirm(t, b, o),
  showAppMessage: vi.fn(),
}));

import {
  saveJsonFileDialog,
  showNoteDeletionConfirm,
  showTaskDeletionConfirm,
} from "../../src/repositories/dialogs";

beforeEach(() => {
  save.mockReset();
  fileExists.mockReset();
  showAppConfirm.mockReset();
});

describe("saveJsonFileDialog", () => {
  it("confirms the overwrite the save panel never asked about", async () => {
    // The panel's own overwrite prompt evaluated "/p/MyTasks". Appending .json
    // moves the target to a file the user was never asked about, so without
    // this the caller would write an empty document over a real task list.
    save.mockResolvedValue("/p/MyTasks");
    fileExists.mockResolvedValue(true);
    showAppConfirm.mockResolvedValue(false);

    expect(await saveJsonFileDialog("tasks.json")).toBeNull();
    expect(fileExists).toHaveBeenCalledWith("/p/MyTasks.json");
    expect(showAppConfirm).toHaveBeenCalled();
  });

  it("returns the appended path once the overwrite is confirmed", async () => {
    save.mockResolvedValue("/p/MyTasks");
    fileExists.mockResolvedValue(true);
    showAppConfirm.mockResolvedValue(true);

    expect(await saveJsonFileDialog("tasks.json")).toBe("/p/MyTasks.json");
  });

  it("does not prompt when the appended path is free", async () => {
    save.mockResolvedValue("/p/Fresh");
    fileExists.mockResolvedValue(false);

    expect(await saveJsonFileDialog("tasks.json")).toBe("/p/Fresh.json");
    expect(showAppConfirm).not.toHaveBeenCalled();
  });

  it("does not prompt when the panel already returned a .json path", async () => {
    // The panel evaluated this exact path, so its own prompt covered it.
    save.mockResolvedValue("/p/Existing.json");

    expect(await saveJsonFileDialog("tasks.json")).toBe("/p/Existing.json");
    expect(fileExists).not.toHaveBeenCalled();
    expect(showAppConfirm).not.toHaveBeenCalled();
  });

  it("treats an uppercase extension as already-.json", async () => {
    // On macOS and Windows MyTasks.JSON is the same file as MyTasks.json;
    // appending would create a .JSON.json and collide case-insensitively.
    save.mockResolvedValue("/p/MyTasks.JSON");

    expect(await saveJsonFileDialog("tasks.json")).toBe("/p/MyTasks.JSON");
    expect(fileExists).not.toHaveBeenCalled();
  });

  it("returns null when the panel is cancelled", async () => {
    save.mockResolvedValue(null);
    expect(await saveJsonFileDialog("tasks.json")).toBeNull();
  });
});

describe("permanent deletion confirmations", () => {
  it("names one task and presents a danger-styled Delete action", async () => {
    showAppConfirm.mockResolvedValue(true);

    await expect(
      showTaskDeletionConfirm([{ title: "Write release notes" }]),
    ).resolves.toBe(true);
    expect(showAppConfirm).toHaveBeenCalledWith(
      "Delete Task",
      'Permanently delete "Write release notes"? This cannot be undone.',
      {
        tone: "danger",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
      },
    );
  });

  it("states the selected count for bulk deletion", async () => {
    showAppConfirm.mockResolvedValue(false);

    await expect(
      showTaskDeletionConfirm([{ title: "A" }, { title: "B" }]),
    ).resolves.toBe(false);
    expect(showAppConfirm).toHaveBeenCalledWith(
      "Delete Tasks",
      "Permanently delete 2 selected tasks? This cannot be undone.",
      expect.objectContaining({ tone: "danger", confirmLabel: "Delete" }),
    );
  });

  it("uses the same permanent danger treatment for notes", async () => {
    showAppConfirm.mockResolvedValue(true);

    await showNoteDeletionConfirm();
    expect(showAppConfirm).toHaveBeenCalledWith(
      "Delete Note",
      "Permanently delete this note? This cannot be undone.",
      expect.objectContaining({ tone: "danger", confirmLabel: "Delete" }),
    );
  });
});
