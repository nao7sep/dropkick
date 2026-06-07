// Summarizes, for the unified view, which open lists are missing from the merged
// roll-up and why — so the pane can show that the view is incomplete rather than
// silently dropping lists. A list is "failed" when its file could not be loaded,
// or "loading" when it is not loaded yet and has not errored. Loaded lists
// contribute their tasks and need no notice. The unified-view tab itself is
// skipped (it has no file of its own).

export interface UnifiedLoadState {
  /** Display names of open lists whose file failed to load. */
  failedNames: string[];
  /** Count of open lists not yet loaded and not (yet) errored. */
  loadingCount: number;
}

export function summarizeUnifiedLoadState(
  openTabs: readonly { isUnifiedView: boolean; filePath: string; displayName: string }[],
  loadedPaths: ReadonlySet<string>,
  errorPaths: ReadonlySet<string>,
): UnifiedLoadState {
  const failedNames: string[] = [];
  let loadingCount = 0;
  for (const tab of openTabs) {
    if (tab.isUnifiedView) continue;
    if (errorPaths.has(tab.filePath)) {
      failedNames.push(tab.displayName);
    } else if (!loadedPaths.has(tab.filePath)) {
      loadingCount += 1;
    }
  }
  return { failedNames, loadingCount };
}
