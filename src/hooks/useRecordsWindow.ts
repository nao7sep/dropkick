// The main window's side of the Records window: it opens it with the settings
// the main window holds, tells it when they change, and persists the list
// width it hands back, since state.json has one writer.

import { useCallback, useEffect } from "react";
import { message } from "../i18n/translate";
import { log, showMessage, toErrorFields } from "../repositories";
import {
  onRecordsListWidthCommitted,
  openRecordsWindow,
  sendRecordsContext,
} from "../repositories/records";
import { useAppStateStore } from "../state/app-state-store";
import { usePreferencesStore } from "../state/preferences-store";
import { conversionTimeZone } from "../utils/timezone";
import {
  RECORDS_LIST_WIDTH,
  RECORDS_WINDOW_MIN_HEIGHT,
  RECORDS_WINDOW_MIN_WIDTH,
} from "../utils/recordsWindowSizing";
import { useInterfaceLanguage } from "./useInterfaceLanguage";

export function useRecordsWindowSync(): void {
  const { language, locale } = useInterfaceLanguage();
  const timezone = usePreferencesStore((s) => s.preferences.timezone);
  const fontFamily = usePreferencesStore((s) => s.preferences.fontFamily);
  const stepViewState = useAppStateStore((s) => s.stepViewState);
  const timeZone = conversionTimeZone(timezone) ?? null;

  useEffect(() => {
    sendRecordsContext({ language, locale, timeZone, fontFamily }).catch((error) =>
      log.warn("records window settings update failed", toErrorFields(error)),
    );
  }, [language, locale, timeZone, fontFamily]);

  useEffect(
    () =>
      onRecordsListWidthCommitted((width) => {
        if (typeof width !== "number" || !Number.isFinite(width)) return;
        const recordsListWidth = Math.max(RECORDS_LIST_WIDTH.min, Math.min(RECORDS_LIST_WIDTH.max, Math.round(width)));
        // A drag's end or one keyboard step: saved after the last of a run.
        stepViewState({ recordsListWidth });
      }),
    [stepViewState],
  );
}

export function useRecordsWindow(): () => Promise<void> {
  const { language, locale } = useInterfaceLanguage();
  const timezone = usePreferencesStore((s) => s.preferences.timezone);
  const timeZone = conversionTimeZone(timezone) ?? null;

  return useCallback(async () => {
    try {
      log.info("open records window", {});
      await openRecordsWindow({
        minWidth: RECORDS_WINDOW_MIN_WIDTH,
        minHeight: RECORDS_WINDOW_MIN_HEIGHT,
        listWidth: useAppStateStore.getState().appState.recordsListWidth,
        language,
        locale,
        timeZone,
        theme: usePreferencesStore.getState().preferences.theme,
        fontFamily: usePreferencesStore.getState().preferences.fontFamily,
      });
    } catch (e) {
      log.error("records window open failed", toErrorFields(e));
      await showMessage(message("records.openFailed.title"), message("records.openFailed.body"));
    }
  }, [language, locale, timeZone]);
}
