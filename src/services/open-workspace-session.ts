// Drain pending writes before replacing the active workspace. App settings and task drafts stay in place.
import { drainAllSerial, loadWorkspace, log, loadFailureFields } from "../repositories";
import { commitParkedFields } from "./commit-task-fields";
import { useWorkspaceStore } from "../state/workspace-store";

export async function openWorkspaceSession(workspacePath: string) {
  commitParkedFields();
  await drainAllSerial();
  const current = useWorkspaceStore.getState();
  // Even a dismissed structural-save warning must not lose its in-memory tabs.
  if (current.loaded && !(await current.saveBeforeSwitch())) return { kind: "save" as const };
  const workspace = await loadWorkspace(workspacePath);
  if (workspace.status !== "success") {
    log.warn("workspace load failed", loadFailureFields(workspacePath, workspace));
    return { kind: "workspace" as const, failure: workspace };
  }
  useWorkspaceStore.getState().adopt(workspacePath, workspace.workspace);
  log.info("session ready", { workspace: { id: workspace.workspace.id, openTabs: workspace.workspace.openTabs.length, recentFiles: workspace.workspace.recentFiles.length } });
  return { kind: "success" as const };
}
