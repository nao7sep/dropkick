// Drain pending writes before replacing the active workspace. App settings and task drafts stay in place.
import { drainRequiredSerial, loadWorkspace, log, loadFailureFields } from "../repositories";
import { commitParkedFields } from "./commit-task-fields";
import { useTaskListStore } from "../state/task-list-store";
import { useWorkspaceStore } from "../state/workspace-store";

export async function openWorkspaceSession(workspacePath: string, isCurrent: () => boolean = () => true) {
  commitParkedFields();
  await drainRequiredSerial();
  if (!isCurrent()) return { kind: "abandoned" as const };
  const lists = useTaskListStore.getState();
  const unsaved = lists.unsavedPaths();
  if (unsaved.length) return { kind: "tasks" as const, paths: unsaved };
  const current = useWorkspaceStore.getState();
  // Even a dismissed structural-save warning must not lose its in-memory tabs.
  if (current.loaded && !(await current.saveBeforeSwitch())) return { kind: "save" as const };
  if (!isCurrent()) return { kind: "abandoned" as const };
  const workspace = await loadWorkspace(workspacePath);
  // The read may settle after startup chose another workspace. Admission owns
  // retirement and adoption; abandoning the read does not cancel physical I/O.
  if (!isCurrent()) return { kind: "abandoned" as const };
  if (workspace.status !== "success") {
    log.warn("workspace load failed", loadFailureFields(workspacePath, workspace));
    return { kind: "workspace" as const, failure: workspace };
  }
  // This transition survives MainWindow unmounting for the picker. Retire
  // departed lists only after the new workspace has proved readable.
  const retained = new Set(workspace.workspace.openTabs.filter((tab) => !tab.isUnifiedView).map((tab) => tab.filePath));
  const liveLists = useTaskListStore.getState();
  for (const path of liveLists.ownedFilePaths()) if (!retained.has(path)) void liveLists.unloadFile(path);
  useWorkspaceStore.getState().adopt(workspacePath, workspace.workspace);
  log.info("session ready", { workspace: { id: workspace.workspace.id, openTabs: workspace.workspace.openTabs.length, recentFiles: workspace.workspace.recentFiles.length } });
  return { kind: "success" as const };
}
