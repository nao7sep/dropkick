import { message, type Message } from "../i18n/translate";

export function describeAppStateRecovery(_quarantinedTo: string): Message {
  return message("recovery.appState");
}

export function describeNoteDraftRecovery(_quarantinedTo: string): Message {
  return message("recovery.noteDrafts");
}
