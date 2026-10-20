import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../../src/i18n/languages";

// macOS draws some menu items itself (Emoji & Symbols, Start Dictation,
// AutoFill, Services) in the language AppKit settles on, and AppKit only
// settles on a language the bundle declares. The Rust core points AppKit at the
// interface language; this keeps the declaration in step with the catalogues.
describe("macOS bundle localizations", () => {
  it("declares every interface language", () => {
    const plist = readFileSync(join(process.cwd(), "src-tauri/Info.plist"), "utf8");
    const block = /<key>CFBundleLocalizations<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist)?.[1] ?? "";
    const declared = [...block.matchAll(/<string>([^<]+)<\/string>/g)].map((match) => match[1]);
    expect(declared).toEqual([...LANGUAGES]);
  });
});

// The Windows installer speaks the interface languages too; NSIS names each by
// its own language name, so this maps the app's tags to them and checks the
// installer list against the app's.
describe("Windows installer languages", () => {
  it("are the interface languages, in the same order", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8")) as {
      bundle: { windows: { nsis: { languages: string[] } } };
    };
    const nsisName: Record<string, string> = {
      en: "English", de: "German", es: "Spanish", fr: "French", it: "Italian",
      "pt-BR": "PortugueseBR", ru: "Russian", ja: "Japanese", ko: "Korean", "zh-Hans": "SimpChinese",
    };
    expect(config.bundle.windows.nsis.languages).toEqual(LANGUAGES.map((language) => nsisName[language]));
  });
});
