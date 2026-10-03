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

export function useRecordsWindow(): () => Promise<void> {
  const { language, locale } = useInterfaceLanguage();
  const timezone = usePreferencesStore((s) => s.preferences.timezone);
  const updateViewState = useAppStateStore((s) => s.updateViewState);
  const timeZone = conversionTimeZone(timezone) ?? null;

  useEffect(() => {
    sendRecordsContext({ language, locale, timeZone }).catch((error) =>
      log.warn("records window settings update failed", toErrorFields(error)),
    );
  }, [language, locale, timeZone]);

  useEffect(
    () =>
      onRecordsListWidthCommitted((width) => {
        if (typeof width !== "number" || !Number.isFinite(width)) return;
        const recordsListWidth = Math.max(RECORDS_LIST_WIDTH.min, Math.min(RECORDS_LIST_WIDTH.max, Math.round(width)));
        void updateViewState({ recordsListWidth });
      }),
    [updateViewState],
  );

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
      });
    } catch (e) {
      log.error("records window open failed", toErrorFields(e));
      await showMessage(message("records.openFailed.title"), message("records.openFailed.body"));
    }
  }, [language, locale, timeZone]);
}
