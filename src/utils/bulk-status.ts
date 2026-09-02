/**
 * Group selected tasks' ids by their source file — the pure decision behind a
 * unified-view move, where each source file's tasks are moved as one batch.
 */
export function groupMoveBySource(
  tasks: readonly { sourceFile: string; id: string }[],
): Map<string, Set<string>> {
  const bySource = new Map<string, Set<string>>();
  for (const task of tasks) {
    const ids = bySource.get(task.sourceFile) ?? new Set<string>();
    ids.add(task.id);
    bySource.set(task.sourceFile, ids);
  }
  return bySource;
}
