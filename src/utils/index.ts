export { generateId } from "./ids";

export {
  nowUtc,
  todayInTimezone,
  tomorrowInTimezone,
  formatTimestamp,
  formatDueDate,
  isOverdue,
  isDueInDayRange,
} from "./dates";

export { createTask, createNote } from "./factories";
export type { CreateTaskOptions } from "./factories";

export { computeGroup, toTask, toDto } from "./domain-mapping";

export { sanitizeSingleLine } from "./sanitize";
export {
  hasPrimaryShortcutModifier,
  matchesShortcutKey,
  consumesSpace,
  primaryModifierLabel,
  isOpenSettingsShortcut,
  isOpenShortcutsHelpShortcut,
} from "./shortcuts";

export {
  parseTaskKey,
  pickNextActiveKey,
  taskKey,
  taskSelectionKey,
  rowDomId,
  stepIndex,
  pageStepIndex,
  rangeKeysBetween,
  planListArrowDown,
} from "./selection";
export type { ListArrowDownPlan } from "./selection";

export { isZoomIn, isZoomOut, isZoomReset, stepZoomIn, stepZoomOut, ZOOM_LEVELS, ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX } from "./zoom";
