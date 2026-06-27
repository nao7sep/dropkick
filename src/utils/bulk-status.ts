import type { ActionResult } from "../state";

export interface BulkStatusSummary {
  /** Validation skips, tallied by reason, in first-seen order. */
  reasons: Array<{ reason: string; count: number }>;
  /** Total tasks skipped by validation (sum of reason counts). */
  skippedCount: number;
  /** The first hard error encountered, if any. */
  firstError: string | null;
  /** Reasons rendered as `reasonA; reasonB (2 tasks)`; empty when none. */
  reasonsText: string;
  /** True when anything went wrong — a skip or an error. */
  hasIssues: boolean;
}

/**
 * Aggregate the per-task results of a bulk status change into one summary:
 * validation results tallied by reason (a count > 1 is annotated) and the first
 * hard error captured. This is the reason-counting that was copy-pasted into
 * both `BulkActions.handleBulkStatus` and the keyboard-shortcut hook; pure, so
 * each presentation layer formats the same numbers its own way.
 */
export function summarizeBulkStatusResult(results: readonly ActionResult[]): BulkStatusSummary {
  const validationReasons = new Map<string, number>();
  let firstError: string | null = null;

  for (const result of results) {
    if (result.status === "validation") {
      validationReasons.set(result.reason, (validationReasons.get(result.reason) ?? 0) + 1);
    } else if (result.status === "error" && firstError === null) {
      firstError = result.message;
    }
  }

  const reasons = [...validationReasons.entries()].map(([reason, count]) => ({ reason, count }));
  const skippedCount = reasons.reduce((total, { count }) => total + count, 0);
  const reasonsText = reasons
    .map(({ reason, count }) => (count === 1 ? reason : `${reason} (${count} tasks)`))
    .join("; ");

  return {
    reasons,
    skippedCount,
    firstError,
    reasonsText,
    hasIssues: skippedCount > 0 || firstError !== null,
  };
}

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
