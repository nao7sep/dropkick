import type { GroupedTasks } from "./grouping";

// The task pane is mandatory, but the Handled archive is an optional folded
// section inside it. Hidden handled rows therefore do not make the visible body
// non-empty; the disclosure stays available while the body explains that there
// is no active work.
export function taskListEmptyMessage(
  grouped: Pick<GroupedTasks, "groups" | "handledTotal">,
  handledExpanded: boolean,
): string | null {
  if (grouped.groups.length > 0) return null;
  if (grouped.handledTotal === 0) return "No tasks yet.";
  return handledExpanded ? null : "No active tasks.";
}
