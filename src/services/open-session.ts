// A pair is validated before either active document changes. Picker selection
// never mutates the session, and queued getters finish against their old stores.
import { drainAllSerial, loadPreferences, loadWorkspace, log, loadFailureFields } from "../repositories";
import { usePreferencesStore } from "../state/preferences-store";
import { useWorkspaceStore } from "../state/workspace-store";

export async function openSession(preferencesPath: string, workspacePath: string) {
  await drainAllSerial();
  const current = useWorkspaceStore.getState();
  // Even a dismissed structural-save warning must not lose its in-memory tabs.
  if (current.loaded && !(await current.saveBeforeSwitch())) return { kind: "save" as const };
  const preferences = await loadPreferences(preferencesPath);
  if (preferences.status !== "success") {
    log.warn("preferences load failed", loadFailureFields(preferencesPath, preferences));
    return { kind: "preferences" as const, failure: preferences };
  }
  const workspace = await loadWorkspace(workspacePath);
  if (workspace.status !== "success") {
    log.warn("workspace load failed", loadFailureFields(workspacePath, workspace));
    return { kind: "workspace" as const, failure: workspace };
  }
  usePreferencesStore.getState().adopt(preferencesPath, preferences.preferences);
  useWorkspaceStore.getState().adopt(workspacePath, workspace.workspace);
  log.info("session ready", { preferences: preferences.preferences, workspace: { id: workspace.workspace.id, openTabs: workspace.workspace.openTabs.length, recentFiles: workspace.workspace.recentFiles.length } });
  return { kind: "success" as const };
}
