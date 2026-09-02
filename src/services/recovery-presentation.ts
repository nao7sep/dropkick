export function describeAppStateRecovery(_quarantinedTo: string): string {
  return "Dropkick could not read its saved workspace and preferences list. A preserved copy remains available, and its location is recorded in the application log. The underlying workspace and preferences files were not changed; reopen any non-default ones you still use.";
}

export function describeNoteDraftRecovery(_quarantinedTo: string): string {
  return "Dropkick could not read the note text you had typed but not yet saved. A preserved copy remains available, and its location is recorded in the application log. Your task lists were not affected.";
}
