import type { NoteDto, TaskDto, TaskListDto } from "../models";

// Ephemeral edit intent follows immutable task/note snapshots. Value equality
// alone cannot distinguish A/B/A typing from input unchanged during a read.
const fieldEdits = new WeakMap<object, Record<string, number>>();
const orderEdits = new WeakMap<object, number>();
let nextEdit = 0;

function markFields(before: object, current: object): void {
  if (before === current) return;
  const prior = fieldEdits.get(before) ?? {};
  const edits = { ...prior };
  for (const [key, value] of Object.entries(current)) {
    if (value !== (before as Record<string, unknown>)[key]) edits[key] = ++nextEdit;
  }
  fieldEdits.set(current, edits);
}

function markItems<T extends { id: string }>(before: T[], current: T[], mark: (before: T, current: T) => void): void {
  if (before === current) return;
  const prior = new Map(before.map((item) => [item.id, item]));
  for (const item of current) {
    const old = prior.get(item.id);
    if (old) mark(old, item);
  }
  const sameOrder = before.length === current.length && before.every((item, index) => item.id === current[index].id);
  orderEdits.set(current, sameOrder ? orderEdits.get(before) ?? 0 : ++nextEdit);
}

export function markTaskListEdit(before: TaskListDto, current: TaskListDto): void {
  markItems(before.tasks, current.tasks, (old, now) => {
    markFields(old, now);
    markItems(old.notes, now.notes, markFields);
  });
}

function fieldChanged(before: object, current: object, key: string, value: unknown): boolean {
  return value !== (before as Record<string, unknown>)[key] ||
    (fieldEdits.get(before)?.[key] ?? 0) !== (fieldEdits.get(current)?.[key] ?? 0);
}

function hasLaterEdit(before: object, current: object): boolean {
  return Object.entries(current).some(([key, value]) => fieldChanged(before, current, key, value));
}

function retainLaterFields<T extends { id: string }>(before: T, current: T, saved: T): T {
  if (before === current) return saved;
  const changes = Object.fromEntries(
    Object.entries(current).filter(([key, value]) => fieldChanged(before, current, key, value)),
  );
  const retained = { ...saved, ...changes };
  fieldEdits.set(retained, fieldEdits.get(current) ?? {});
  return retained;
}

function retainLaterNotes(before: NoteDto[], current: NoteDto[], saved: NoteDto[]): NoteDto[] {
  return retainLaterItems(before, current, saved, retainLaterFields);
}

function retainLaterTask(before: TaskDto, current: TaskDto, saved: TaskDto): TaskDto {
  const task = retainLaterFields(before, current, saved);
  if (before.notes === current.notes) return task;
  const retained = { ...task, notes: retainLaterNotes(before.notes, current.notes, saved.notes) };
  fieldEdits.set(retained, fieldEdits.get(current) ?? {});
  return retained;
}

function retainLaterItems<T extends { id: string }>(
  before: T[], current: T[], saved: T[], merge: (before: T, current: T, saved: T) => T,
): T[] {
  if (before === current) return saved;
  const prior = new Map(before.map((item) => [item.id, item]));
  const latest = new Map(current.map((item) => [item.id, item]));
  const settled = saved.flatMap((item) => {
    const old = prior.get(item.id);
    const now = latest.get(item.id);
    if (old && !now) return [];
    return [old && now ? merge(old, now, item) : item];
  });
  const savedIds = new Set(saved.map((item) => item.id));
  const added = current.filter((item) => {
    if (savedIds.has(item.id)) return false;
    const old = prior.get(item.id);
    return !old || hasLaterEdit(old, item);
  });
  const result = [...added, ...settled];
  if (before.length === current.length && before.every((item, index) => item.id === current[index].id) &&
    (orderEdits.get(before) ?? 0) === (orderEdits.get(current) ?? 0)) {
    orderEdits.set(result, orderEdits.get(current) ?? 0);
    return result;
  }
  const byId = new Map(result.map((item) => [item.id, item]));
  // A later local reorder owns the order of its existing items. Disk-only
  // additions still lead, as an added task or note does in the app.
  const ordered = [
    ...result.filter((item) => !latest.has(item.id)),
    ...current.flatMap((item) => byId.has(item.id) ? [byId.get(item.id)!] : []),
  ];
  orderEdits.set(ordered, orderEdits.get(current) ?? 0);
  return ordered;
}

export function retainLaterTaskList(
  before: TaskListDto, current: TaskListDto, saved: TaskListDto,
): TaskListDto {
  if (before === current) return saved;
  return { ...saved, tasks: retainLaterItems(before.tasks, current.tasks, saved.tasks, retainLaterTask) };
}

export function settleTaskMove(
  beforeSource: TaskListDto, beforeDestination: TaskListDto,
  currentSource: TaskListDto, currentDestination: TaskListDto,
  savedSource: TaskListDto, savedDestination: TaskListDto,
): { sourceData: TaskListDto; destData: TaskListDto } {
  const remaining = new Set(savedSource.tasks.map((task) => task.id));
  const moved = new Map(beforeSource.tasks.filter((task) => !remaining.has(task.id)).map((task) => [task.id, task]));
  const latestSource = new Map(currentSource.tasks.map((task) => [task.id, task]));
  // Removal by this move belongs to the source; later edits of moved tasks
  // follow their destination rather than restoring a second source copy.
  const sourceData = beforeSource === currentSource ? savedSource : retainLaterTaskList(
    { ...beforeSource, tasks: beforeSource.tasks.filter((task) => !moved.has(task.id)) },
    { ...currentSource, tasks: currentSource.tasks.filter((task) => !moved.has(task.id)) },
    savedSource,
  );
  const destData = retainLaterTaskList(beforeDestination, currentDestination, savedDestination);
  if (beforeSource === currentSource) return { sourceData, destData };
  return {
    sourceData,
    destData: { ...destData, tasks: destData.tasks.flatMap((task) => {
      const old = moved.get(task.id);
      if (!old) return [task];
      const now = latestSource.get(task.id);
      return now ? [retainLaterTask(old, now, task)] : [];
    }) },
  };
}
