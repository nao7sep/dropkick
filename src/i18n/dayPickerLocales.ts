import { de, enUS, es, fr, it, ja, ko, ptBR, ru, zhCN } from "react-day-picker/locale";
import type { DayPickerLocale } from "react-day-picker/locale";
import type { Language } from "./languages";

// The calendar's month and weekday names, first day of the week, and its own
// button labels, per interface language.
export const DAY_PICKER_LOCALES: Readonly<Record<Language, DayPickerLocale>> = {
  en: enUS,
  de,
  es,
  fr,
  it,
  "pt-BR": ptBR,
  ru,
  ja,
  ko,
  "zh-Hans": zhCN,
};
