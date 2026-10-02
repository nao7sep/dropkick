import { describe, expect, it } from "vitest";
import { enUS, ja } from "react-day-picker/locale";
import { dayPickerLocale, loadDayPickerLocale } from "../../src/i18n/dayPickerLocales";
import { LANGUAGES } from "../../src/i18n/languages";

describe("dayPickerLocale", () => {
  it("is English until the language's locale has loaded", async () => {
    expect(dayPickerLocale("ja")).toBe(enUS);
    await loadDayPickerLocale("ja");
    expect(dayPickerLocale("ja").code).toBe(ja.code);
  });

  it("loads a locale for every interface language", async () => {
    const codes = await Promise.all(LANGUAGES.map(async (language) => (await loadDayPickerLocale(language)).code));
    expect(codes).toEqual(["en-US", "de", "es", "fr", "it", "pt-BR", "ru", "ja", "ko", "zh-CN"]);
  });
});
