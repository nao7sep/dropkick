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

export { singleLine, multiline } from "./textCleanup";
export {
  hasPrimaryShortcutModifier,
  hasPointerCommandModifier,
  shadowsMacTextBinding,
  noteEditorAction,
  isEditableTarget,
  standsDownForMacText,
  matchesShortcutKey,
  consumesSpace,
  primaryModifierLabel,
  isOpenSettingsShortcut,
  isOpenShortcutsHelpShortcut,
  tabCycleDirection,
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

export {
  SIDEBAR_MIN_WIDTH,
  DETAIL_MIN_WIDTH,
  CONTENT_MIN_HEIGHT,
  TAB_BAR_MIN_HEIGHT,
  SPLITTER_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  computeMinWindowWidth,
  computeMinWindowHeight,
  clampSidebarWidth,
} from "./windowSizing";

export { summarizeBulkStatusResult, groupMoveBySource } from "./bulk-status";
export type { BulkStatusSummary } from "./bulk-status";
