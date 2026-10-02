import en from "./locales/en.json";
import type { Language } from "./languages";

// English defines the key set; every other catalogue carries every key, with
// plural entries keyed by the language's own CLDR categories. The catalogue
// gate (tests/i18n/catalogues.test.ts) checks keys, placeholders, plural forms,
// and untranslated English.
export type MessageKey = keyof typeof en;

export type CatalogueEntry = string | Readonly<Record<string, string>>;

export type Catalogue = Readonly<Record<MessageKey, CatalogueEntry>>;

// One dynamic import per catalogue, so only the interface language and English
// are loaded (localization-stack-conventions). English is static: it is the
// fallback.
const LOADERS: Readonly<Record<Language, () => Promise<Catalogue>>> = {
  en: () => Promise.resolve(en),
  de: () => import("./locales/de.json").then((m) => m.default),
  es: () => import("./locales/es.json").then((m) => m.default),
  fr: () => import("./locales/fr.json").then((m) => m.default),
  it: () => import("./locales/it.json").then((m) => m.default),
  "pt-BR": () => import("./locales/pt-BR.json").then((m) => m.default),
  ru: () => import("./locales/ru.json").then((m) => m.default),
  ja: () => import("./locales/ja.json").then((m) => m.default),
  ko: () => import("./locales/ko.json").then((m) => m.default),
  "zh-Hans": () => import("./locales/zh-Hans.json").then((m) => m.default),
};

const loaded = new Map<Language, Catalogue>([["en", en]]);

export async function loadCatalogue(language: Language): Promise<Catalogue> {
  const catalogue = loaded.get(language) ?? (await LOADERS[language]());
  loaded.set(language, catalogue);
  return catalogue;
}

export function loadedCatalogue(language: Language): Catalogue | undefined {
  return loaded.get(language);
}
