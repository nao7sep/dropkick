import type { StoreRecovery } from "../models";
import { message, type Message } from "../i18n/translate";

// A notice's title and body. Neither names the internal path; the log records it.
export interface RecoveryNotice {
  title: Message;
  body: Message;
}

export function describeAppConfigRecovery(recovery: StoreRecovery): RecoveryNotice {
  return recovery.kind === "newer"
    ? { title: message("startup.appConfigNewer.title"), body: message("recovery.appConfigNewer") }
    : { title: message("startup.appConfigReset.title"), body: message("recovery.appConfig") };
}
