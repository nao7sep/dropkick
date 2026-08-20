// Dialog helpers.
// File pickers remain native via Tauri; message/confirm dialogs are rendered in-app.

import { open, save } from "@tauri-apps/plugin-dialog";
import { showAppConfirm, showAppMessage } from "../state/dialog-store";
import { fileExists } from "./file-system";

// Opens a native file dialog for selecting an existing JSON file.
// Returns the selected file path, or null if cancelled.
export async function openJsonFileDialog(): Promise<string | null> {
  const result = await open({
    multiple: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  // open() returns string | string[] | null depending on `multiple`.
  if (result === null) return null;
  if (Array.isArray(result)) return result[0] ?? null;
  return result;
}

// Opens a native save dialog for creating a new JSON file, and returns the
// path to create — with a `.json` extension — or null if the user cancelled or
// declined an overwrite.
//
// The extension has to be settled here rather than at each call site, because
// appending it moves the target: the save panel's own overwrite prompt
// evaluated the path it returned, so a user who types `MyTasks` where
// `MyTasks.json` already exists was asked about a file that does not exist and
// never asked about the one that does. Callers then wrote over it with an empty
// document. When the append changes the path, the overwrite is confirmed here.
//
// The extension test is case-insensitive: on macOS and Windows `MyTasks.JSON`
// is the same file as `MyTasks.json`, and appending to it would both create a
// `.JSON.json` and collide case-insensitively with an existing sibling
// (storage-path-conventions).
export async function saveJsonFileDialog(
  defaultName?: string,
): Promise<string | null> {
  const picked = await save({
    defaultPath: defaultName,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (picked === null) return null;
  if (picked.toLowerCase().endsWith(".json")) return picked;

  const path = `${picked}.json`;
  if (!(await fileExists(path))) return path;
  const overwrite = await showAppConfirm(
    "Replace Existing File?",
    `A file already exists at:\n\n${path}\n\nCreating a new one here replaces its contents.`,
    {
      tone: "warning",
      confirmLabel: "Replace",
      cancelLabel: "Cancel",
    },
  );
  return overwrite ? path : null;
}

// Shows an informational message dialog.
export async function showMessage(
  title: string,
  body: string,
): Promise<void> {
  await showAppMessage(title, body);
}

// Shows a confirmation dialog with OK/Cancel.
// Returns true if the user confirmed.
export async function showConfirm(
  title: string,
  body: string,
): Promise<boolean> {
  return await showAppConfirm(title, body);
}

// Shows a conflict dialog for external file modifications.
// Returns "overwrite" or "cancel".
//
// Neither choice is safe: Overwrite destroys whatever wrote the file, and
// Discard & Reload destroys the user's in-app change. So the dialog is opened
// with `noSafeAction`: no button takes focus, a reflexive Enter does nothing,
// and — because there is no safe exit to route them to — Escape and the
// backdrop do nothing either (AppDialogHost returns early on noSafeAction).
// The user has to pick. A third do-nothing exit was considered and rejected
// because it would re-raise this same dialog on the next write, which the
// repository deliberately avoids by dropping the stored hash.
export async function showFileConflictDialog(
  filePath: string,
): Promise<"overwrite" | "cancel"> {
  const overwrite = await showAppConfirm(
    "File Modified Externally",
    `The file has been modified outside Dropkick:\n\n${filePath}\n\nOverwrite with your version, or discard your changes and reload?`,
    {
      tone: "warning",
      confirmLabel: "Overwrite",
      cancelLabel: "Discard & Reload",
      noSafeAction: true,
    },
  );
  return overwrite ? "overwrite" : "cancel";
}

// Shows a confirmation dialog when the user tries to close a form with unsaved changes.
// Returns true if the user chose to discard changes, false to keep editing.
export async function showUnsavedChangesConfirm(): Promise<boolean> {
  return await showAppConfirm(
    "Discard Changes",
    "You have unsaved changes. Discard them and close?",
    {
      tone: "warning",
      confirmLabel: "Discard",
      cancelLabel: "Keep Editing",
    },
  );
}

// Shows a dialog when a file has been deleted while open.
// Returns "save" or "cancel".
export async function showFileDeletedDialog(
  filePath: string,
): Promise<"save" | "cancel"> {
  const save = await showAppConfirm(
    "File Deleted",
    `This file no longer exists:\n\n${filePath}\n\nSave to recreate it, or cancel this change?`,
    {
      tone: "warning",
      confirmLabel: "Save",
      cancelLabel: "Cancel",
    },
  );
  return save ? "save" : "cancel";
}
