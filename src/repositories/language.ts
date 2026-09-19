// The interface language's native half (src-tauri/src/i18n.rs). The Rust core
// reads the computer's languages once at launch and resolves them to a
// supported tag; the frontend resolves System against that reading, and asks
// the core to rebuild the native menu when the language changes.

import { invoke } from "@tauri-apps/api/core";

export interface LanguageEnvironment {
  systemLanguage: string;
  systemLocale: string | null;
}

export async function loadLanguageEnvironment(): Promise<LanguageEnvironment> {
  return invoke<LanguageEnvironment>("language_environment");
}

export async function applyLanguage(language: string): Promise<void> {
  await invoke<void>("apply_language", { language });
}
