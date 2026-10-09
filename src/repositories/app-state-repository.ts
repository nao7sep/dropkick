// Owns state.json, initial document creation, and serialized view-state writes.

import type { AppStateDto } from "../models";
import { createDefaultAppState, isV010Document } from "../models";
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
import { log, type LogFields } from "./logging";
import { ZOOM_MIN, ZOOM_MAX } from "../utils/zoom";


const STRING_FIELDS = [
  "lastPreferencesPath",
  "lastLaunchedPreferencesPath",
  "lastWorkspacePath",
] as const satisfies readonly (keyof AppStateDto)[];
const NUMBER_FIELDS = ["zoomLevel", "sidebarWidth", "recordsListWidth"] as const satisfies
  readonly (keyof AppStateDto)[];

// The state as this build writes it, every field present, or why the file is
// not that. Unrecognized keys are left behind.
function parseAppState(value: unknown): AppStateDto | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "state root is not an object";
  }
  const data = value as Record<string, unknown>;
  for (const field of STRING_FIELDS) {
    if (typeof data[field] !== "string") return `${field} is not a string`;
  }
  for (const field of NUMBER_FIELDS) {
    const number = data[field];
    if (typeof number !== "number" || !Number.isFinite(number)) {
      return `${field} is not a finite number`;
    }
  }
  if ((data.zoomLevel as number) < ZOOM_MIN || (data.zoomLevel as number) > ZOOM_MAX) {
    return "zoomLevel is outside the supported range";
  }
  return Object.fromEntries(
    [...STRING_FIELDS, ...NUMBER_FIELDS].map((field) => [field, data[field]]),
  ) as unknown as AppStateDto;
}

// First-launch setup: creates ~/.dropkick/ with the default state, preferences
// and workspace documents. Once the state file exists, selected files are never
// recreated implicitly; missing selections are reported by their loaders.
//
// `statePath` is empty when state.json was written by a newer build: the
// session runs on the default state and writes nothing over that file.
export async function initializeAppState(): Promise<{
  appState: AppStateDto;
  statePath: string;
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
  const configResult = await readJsonFileResult<unknown>(statePath, "state");
  if (configResult.status === "error") {
    throw new Error(`Failed to load app appState: ${configResult.message}`);
  }

  // State is disposable, so a reset is not reported to the user; its record
  // says why (store-recovery-conventions).
  let appState: AppStateDto | null = null;
  let resetReason: LogFields | null = null;
  if (configResult.status === "invalid") {
    resetReason = { error: { message: configResult.message } };
  } else if (configResult.status === "success" && isV010Document(configResult.data)) {
    // v0.1.0's state.json held the last-used paths and the saved locations
    // (developer decision: the next version opens v0.1.0's files). The paths
    // carry over here, the locations in loadAppConfig, and the file is left as
    // it is until the next view-state save writes this build's state.
    const data = configResult.data;
    const path = (value: unknown, fallback: string) =>
      typeof value === "string" && value !== "" ? value : fallback;
    const lastPreferencesPath = path(data.lastPreferencesPath, prefsPath);
    appState = {
      ...createDefaultAppState(),
      lastPreferencesPath,
      lastLaunchedPreferencesPath: lastPreferencesPath,
      lastWorkspacePath: path(data.lastWorkspacePath, workspacePath),
    };
  } else if (configResult.status === "success") {
    const parsed = parseAppState(configResult.data);
    if (typeof parsed === "string") resetReason = { issue: parsed };
    else appState = parsed;
  }
  if (resetReason) {
    const quarantinedTo = await quarantineFile(statePath, "state");
    log.warn("state.json reset", { statePath, quarantinedTo, ...resetReason });
  }

  const newer = configResult.status === "newer";
  if (newer) {
    // Disposable view state: the log names the file the session leaves alone.
    log.warn("state.json is newer than this build; left in place and not written this session", {
      statePath,
      formatVersion: configResult.formatVersion,
    });
  }
  const created = appState === null && !newer;
  if (appState === null) {
    appState = {
      ...createDefaultAppState(),
      lastPreferencesPath: prefsPath,
      lastWorkspacePath: workspacePath,
    };
  }
  if (created) await writeJsonFile(statePath, "state", appState, false);

  // Create missing default documents through their owning repositories.
  if (!(await fileExists(prefsPath))) {
    await createPreferencesFile(prefsPath, "Default");
  }
  if (!(await fileExists(workspacePath))) {
    await createWorkspaceFile(workspacePath, "Default");
  }

  log.info("app state initialized", { statePath, created });
  return { appState, statePath: newer ? "" : statePath };
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
    await writeJsonFile(filePath, "state", getAppState(), false);
  });
}
