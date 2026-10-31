import type { FileRefusal } from "../models";
import { message, type Message } from "../i18n/translate";

// A notice's title and body.
export interface RecoveryNotice {
  title: Message;
  body: Message;
}

// The launch stop (store-recovery-conventions, What a refused file does): one
// paragraph per refused file, naming it and whether a newer version wrote it
// or it could not be read, then what the user can do.
export function describeLaunchStop(refusals: readonly FileRefusal[]): Message[] {
  return [
    message("startup.refused.intro"),
    ...refusals.map((refusal) => message(
      refusal.reason === "newer" ? "startup.refused.newer" : "startup.refused.unreadable",
      { path: refusal.path },
    )),
    message("startup.refused.help"),
  ];
}

// A side store that could not be read is off for the session, and says so.
export function describeSideStoreOff(store: "records" | "backups", path: string): RecoveryNotice {
  return store === "records"
    ? { title: message("startup.recordsOff.title"), body: message("startup.recordsOff.body", { path }) }
    : { title: message("startup.backupsOff.title"), body: message("startup.backupsOff.body", { path }) };
}
