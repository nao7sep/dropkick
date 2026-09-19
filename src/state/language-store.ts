// LanguageStore — the computer's language and regional locale, read once from
// the Rust core at launch. The interface language is the preferences
// document's choice, with System resolved against this reading (see
// useInterfaceLanguage).

import { create } from "zustand";
import { isLanguage, type Language } from "../i18n/languages";
import { loadLanguageEnvironment, log, toErrorFields } from "../repositories";

interface LanguageState {
  systemLanguage: Language;
  systemLocale: string | null;
  load: () => Promise<void>;
}

export const useLanguageStore = create<LanguageState>((set) => ({
  systemLanguage: "en",
  systemLocale: null,

  // A failed read leaves English and the language's own formats, which the
  // interface can always speak.
  load: async () => {
    try {
      const environment = await loadLanguageEnvironment();
      set({
        systemLanguage: isLanguage(environment.systemLanguage) ? environment.systemLanguage : "en",
        systemLocale: environment.systemLocale,
      });
    } catch (e) {
      log.warn("language environment read failed", toErrorFields(e));
    }
  },
}));
