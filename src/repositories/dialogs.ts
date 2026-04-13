// Dialog helpers.
// File pickers remain native via Tauri; message/confirm dialogs are rendered in-app.

import { open, save } from "@tauri-apps/plugin-dialog";
import { showAppConfirm, showAppMessage } from "../state/dialog-store";

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

// Opens a native save dialog for creating a new JSON file.
// Returns the chosen file path, or null if cancelled.
export async function saveJsonFileDialog(
  defaultName?: string,
): Promise<string | null> {
  const result = await save({
    defaultPath: defaultName,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  return result;
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
    },
  );
  return overwrite ? "overwrite" : "cancel";
}

// Shows a dialog when a file has been deleted while open.
// Returns "save" or "close".
export async function showFileDeletedDialog(
  filePath: string,
): Promise<"save" | "close"> {
  const save = await showAppConfirm(
    "File Deleted",
    `This file no longer exists:\n\n${filePath}\n\nSave to recreate it, or close the tab?`,
    {
      tone: "warning",
      confirmLabel: "Save",
      cancelLabel: "Close Tab",
    },
  );
  return save ? "save" : "close";
}
