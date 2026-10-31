// The interface language: the settings document's choice, with System
// resolved to the computer's language, and the locale dates and numbers are
// formatted in. Before a document is loaded the in-memory default is System.

import { effectiveLanguage, formattingLocale, type Language } from "../i18n/languages";
import { useLanguageStore } from "../state/language-store";
import { useSettingsStore } from "../state/settings-store";

export function useInterfaceLanguage(): { language: Language; locale: string } {
  const preference = useSettingsStore((s) => s.settings.language);
  const systemLanguage = useLanguageStore((s) => s.systemLanguage);
  const systemLocale = useLanguageStore((s) => s.systemLocale);
  const language = effectiveLanguage(preference, systemLanguage);
  return { language, locale: formattingLocale(language, systemLocale) };
}

// The same language, read outside React.
export function currentInterfaceLanguage(): Language {
  return effectiveLanguage(
    useSettingsStore.getState().settings.language,
    useLanguageStore.getState().systemLanguage,
  );
}
