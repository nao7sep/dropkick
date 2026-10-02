import type { DayPickerLocale } from "react-day-picker/locale";
import { enUS } from "react-day-picker/locale/en-US";
import type { Language } from "./languages";

// The calendar's month and weekday names, first day of the week, and its own
// button labels, per interface language: one dynamic import per locale
// (localization-conventions, Catalogues). English is static: it is the
// fallback.
const LOADERS: Readonly<Record<Language, () => Promise<DayPickerLocale>>> = {
  en: () => Promise.resolve(enUS),
  de: () => import("react-day-picker/locale/de").then((m) => m.de),
  es: () => import("react-day-picker/locale/es").then((m) => m.es),
  fr: () => import("react-day-picker/locale/fr").then((m) => m.fr),
  it: () => import("react-day-picker/locale/it").then((m) => m.it),
  "pt-BR": () => import("react-day-picker/locale/pt-BR").then((m) => m.ptBR),
  ru: () => import("react-day-picker/locale/ru").then((m) => m.ru),
  ja: () => import("react-day-picker/locale/ja").then((m) => m.ja),
  ko: () => import("react-day-picker/locale/ko").then((m) => m.ko),
  "zh-Hans": () => import("react-day-picker/locale/zh-CN").then((m) => m.zhCN),
};

const loaded = new Map<Language, DayPickerLocale>([["en", enUS]]);

export async function loadDayPickerLocale(language: Language): Promise<DayPickerLocale> {
  const locale = loaded.get(language) ?? (await LOADERS[language]());
  loaded.set(language, locale);
  return locale;
}

// English until the language's locale has loaded.
export function dayPickerLocale(language: Language): DayPickerLocale {
  return loaded.get(language) ?? enUS;
}
