import { CATALOGUES } from "../../src/i18n/catalogues";
import { createTranslator, type Message } from "../../src/i18n/translate";

// Renders a message the way an English interface shows it, so tests can keep
// asserting on the words a user reads.
const english = createTranslator("en", "en-US");

export function inEnglish(message: Message | null | undefined): string | null {
  return message ? english.text(message) : null;
}

// Catalogue keys that reached the screen untranslated: a key rendered as text
// or given to an attribute a person reads or hears. The TypeScript types cannot
// catch this, because a key is a string and React renders any string.
const KEYS = new Set(Object.keys(CATALOGUES.en));
const READ_ATTRIBUTES = ["title", "aria-label", "aria-description", "placeholder", "alt", "label"];
const KEY_LIKE = /[A-Za-z]\w*(?:\.\w+)+/g;

export function renderedKeys(root: Element): string[] {
  // Text nodes one by one: a container's textContent runs neighbours together.
  const texts: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    texts.push(node.nodeValue ?? "");
  }
  for (const element of root.querySelectorAll("*")) {
    for (const name of READ_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value) texts.push(value);
    }
  }
  const found = texts.flatMap((text) => text.match(KEY_LIKE) ?? []).filter((token) => KEYS.has(token));
  return [...new Set(found)];
}
