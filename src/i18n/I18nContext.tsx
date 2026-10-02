import { createContext, useContext, useEffect, useReducer, useState, type ReactNode } from "react";
import { log, toErrorFields } from "../repositories";
import { loadCatalogue, loadedCatalogue } from "./catalogues";
import { isLanguage, type Language } from "./languages";
import { createTranslator, type Translator } from "./translate";

// English until a provider says otherwise, so a component rendered on its own
// (in a test, say) still has text.
const I18nContext = createContext<Translator>(createTranslator("en"));

// Loads the language's catalogue; a failure leaves the interface in the
// language it already speaks.
export async function loadInterfaceCatalogue(language: Language): Promise<void> {
  try {
    await loadCatalogue(language);
  } catch (e) {
    log.warn("catalogue load failed", { language, ...toErrorFields(e) });
  }
}

// Speaks the language once its catalogue has loaded, and the previous one
// until then.
export function I18nProvider({
  language,
  locale,
  children,
}: {
  language: Language;
  locale: string;
  children: ReactNode;
}) {
  const [translator, setTranslator] = useState(() => createTranslator("en"));
  const [, catalogueLoaded] = useReducer((count: number) => count + 1, 0);
  const ready = loadedCatalogue(language) !== undefined;
  if (ready && (translator.language !== language || translator.locale !== locale)) {
    setTranslator(createTranslator(language, locale));
  }

  useEffect(() => {
    if (ready) return;
    let current = true;
    void loadInterfaceCatalogue(language).then(() => {
      if (current) catalogueLoaded();
    });
    return () => {
      current = false;
    };
  }, [language, ready]);

  // <html lang> picks the right glyphs for Chinese, Japanese and Korean text and
  // tells the last-resort error boundary, which sits outside this provider,
  // which language to speak.
  useEffect(() => {
    document.documentElement.lang = translator.language;
  }, [translator.language]);

  return <I18nContext.Provider value={translator}>{children}</I18nContext.Provider>;
}

export function useI18n(): Translator {
  return useContext(I18nContext);
}

// For surfaces outside the provider: the language the document last declared.
export function documentTranslator(): Translator {
  const declared = document.documentElement.lang;
  return createTranslator(isLanguage(declared) && loadedCatalogue(declared) ? declared : "en");
}
