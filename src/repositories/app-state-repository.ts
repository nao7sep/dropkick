// Manages ~/.dropkick/state.json — the app-level state.
//
// Every field here (last selection + known preferences/workspace lists) is
// rebuildable, so the file is state, not durable configuration. There is no
// separate appState.json: dropkick has no app-level user-tunable settings that
// outlive a rebuild — those live in the seeded preferences.json / workspace.json
// user documents.
//
// initializeAppState handles first-launch setup (creating ~/.dropkick/ and
// the seeded preferences/workspace files). It runs exactly once at startup, so
// it doesn't need serialization. All subsequent writes go through
// flushAppState, which uses withSerial — the same pattern as the other
// repositories. The actual data manipulation (register/unregister) lives in
// useAppStateStore; this module owns I/O only.

import type { AppStateDto } from "../models";
import { createDefaultAppState } from "../models";
import {
  readJsonFileResult,
  writeJsonFile,
  quarantineFile,
  ensureDirectory,
  fileExists,
  appPaths,
  withSerial,
} from "./file-system";
import { createPreferencesFile } from "./preferences-repository";
import { createWorkspaceFile } from "./workspace-repository";
import { mergeWithDefaults } from "../utils/merge-defaults";
import { log } from "./logging";


function appStateShapeIssue(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "state root is not an object";
  }

  const data = value as Record<string, unknown>;
  const stringFields = ["version", "lastPreferencesPath", "lastWorkspacePath"] as const;
  for (const field of stringFields) {
    if (data[field] !== undefined && typeof data[field] !== "string") {
      return `${field} is not a string`;
    }
  }

  const pathLists = ["knownPreferences", "knownWorkspaces"] as const;
  for (const field of pathLists) {
    const list = data[field];
    if (list !== undefined && (!Array.isArray(list) || !list.every((item) => typeof item === "string"))) {
      return `${field} is not an array of strings`;
    }
  }

  const numberFields = ["zoomLevel", "sidebarWidth"] as const;
  for (const field of numberFields) {
    const number = data[field];
    if (number !== undefined && (typeof number !== "number" || !Number.isFinite(number))) {
      return `${field} is not a finite number`;
    }
  }

  return null;
}

// First-launch setup: creates ~/.dropkick/ with the default state, preferences
// and workspace documents. Once the state file exists, selected files are never
// recreated implicitly; missing selections are reported by their loaders.
export async function initializeAppState(): Promise<{
  appState: AppStateDto;
  statePath: string;
  quarantinedTo: string | null;
}> {
  const {
    root,
    stateFile: statePath,
    preferencesFile: prefsPath,
    workspaceFile: workspacePath,
  } = await appPaths();

  // Ensure ~/.dropkick/ exists.
  await ensureDirectory(root);

  // Create or read app appState.
  const configResult = await readJsonFileResult<unknown>(statePath);

  let quarantinedTo: string | null = null;
  if (configResult.status === "invalid") {
    quarantinedTo = await quarantineFile(statePath);
    log.warn("corrupt state.json quarantined; recreating defaults", {
      statePath,
      quarantinedTo,
      message: configResult.message,
    });
  } else if (configResult.status === "success") {
    const data = configResult.data;
    const shapeIssue = appStateShapeIssue(data);
    if (shapeIssue) {
      quarantinedTo = await quarantineFile(statePath);
      log.warn("shape-damaged state.json quarantined; recreating defaults", {
        statePath,
        quarantinedTo,
        issue: shapeIssue,
      });
    }
  }

  let appState: AppStateDto;
  const created = configResult.status === "missing" || quarantinedTo !== null;
  if (created) {
    appState = createDefaultAppState();
    appState.lastPreferencesPath = prefsPath;
    appState.lastWorkspacePath = workspacePath;
    appState.knownPreferences = [prefsPath];
    appState.knownWorkspaces = [workspacePath];
    await writeJsonFile(statePath, appState);
  } else if (configResult.status === "success") {
    // Fill any newly added fields from defaults and drop keys no longer part of
    // AppStateDto, so a retired field is never re-emitted — the same
    // load-boundary contract as the preferences and workspace repositories.
    appState = mergeWithDefaults(
      createDefaultAppState(),
      configResult.data as Partial<AppStateDto>,
    );
  } else {
    throw new Error(`Failed to load app appState: ${configResult.message}`);
  }

  // Materialize the built-in default documents whenever they are absent, not
  // only on a first run.
  //
  // Gating this on state.json's absence meant that deleting or moving
  // ~/.dropkick/preferences.json on its own left it gone for good: state.json
  // survived, so nothing re-created it, while knownPreferences still listed it
  // and the picker still preselected it — so Launch dead-ended at "could not be
  // found" with no recovery but New. Absence of the file itself is the single
  // trigger the storage-path conventions name.
  //
  // Creation goes through the owning repositories rather than being open-coded
  // here, so a seeded document and a New-created one cannot drift apart.
  if (!(await fileExists(prefsPath))) {
    await createPreferencesFile(prefsPath, "Default");
  }
  if (!(await fileExists(workspacePath))) {
    await createWorkspaceFile(workspacePath, "Default");
  }

  log.info("app state initialized", { statePath, created });
  return { appState, statePath, quarantinedTo };
}

// Flushes the latest app state to disk. Calls are serialized per path,
// so overlapping flushes can never land out of order. `getAppState` is invoked
// inside the serial slot so it sees the latest store state at the instant of
// the write.
export async function flushAppState(
  filePath: string,
  getAppState: () => AppStateDto,
): Promise<void> {
  await withSerial(filePath, async () => {
    await writeJsonFile(filePath, getAppState());
  });
}
