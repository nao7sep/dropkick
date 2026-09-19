// The interface language: the preferences document's choice, with System
// resolved to the computer's language, and the locale dates and numbers are
// formatted in. Before a document is loaded the in-memory default is System.

import { effectiveLanguage, formattingLocale, type Language } from "../i18n/languages";
import { useLanguageStore } from "../state/language-store";
import { usePreferencesStore } from "../state/preferences-store";

export function useInterfaceLanguage(): { language: Language; locale: string } {
  const preference = usePreferencesStore((s) => s.preferences.language);
  const systemLanguage = useLanguageStore((s) => s.systemLanguage);
  const systemLocale = useLanguageStore((s) => s.systemLocale);
  const language = effectiveLanguage(preference, systemLanguage);
  return { language, locale: formattingLocale(language, systemLocale) };
}
