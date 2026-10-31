// Owns state.json and serialized view-state writes.

import type { AppStateDto, FileRefusal } from "../models";
import { createDefaultAppState } from "../models";
import {
  readJsonFileResult,
  writeJsonFile,
  ensureDirectory,
  appPaths,
  withSerial,
} from "./file-system";
import { log, type LogFields } from "./logging";
import { ZOOM_MIN, ZOOM_MAX } from "../utils/zoom";


const STRING_FIELDS = [
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

// View state is disposable: an unreadable state.json takes the defaults with no
// notice and is left in place for the next save to replace. A newer one stops
// the launch (`refusal`), and the session then has no file to write. Reading
// writes nothing; the file is first written by an ordinary save.
export async function initializeAppState(): Promise<{
  appState: AppStateDto;
  statePath: string;
  refusal: FileRefusal | null;
}> {
  const { root, stateFile: statePath } = await appPaths();

  // Ensure ~/.dropkick/ exists.
  await ensureDirectory(root);

  const result = await readJsonFileResult<unknown>(statePath, "state");
  if (result.status === "newer") {
    log.warn("state.json is newer than this build; left in place", { statePath, formatVersion: result.formatVersion });
    return { appState: createDefaultAppState(), statePath: "", refusal: { path: statePath, reason: "newer" } };
  }

  let appState: AppStateDto | null = null;
  let resetReason: LogFields | null = null;
  if (result.status === "invalid" || result.status === "error") {
    resetReason = { error: { message: result.message } };
  } else if (result.status === "success") {
    const parsed = parseAppState(result.data);
    if (typeof parsed === "string") resetReason = { issue: parsed };
    else appState = parsed;
  }
  if (resetReason) log.warn("state.json is unreadable; using the defaults", { statePath, ...resetReason });

  log.info("app state initialized", { statePath, found: appState !== null });
  return { appState: appState ?? createDefaultAppState(), statePath, refusal: null };
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
  }, "optional");
}
