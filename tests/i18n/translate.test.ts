import { isValidElement, type ReactElement } from "react";
import type { MessageKey } from "../../src/i18n/catalogues";
import { describe, expect, it } from "vitest";
import { createTranslator, message } from "../../src/i18n/translate";

describe("createTranslator", () => {
  it("fills placeholders and formats numbers for the locale", () => {
    expect(createTranslator("en").t("about.version", { version: "1.2.0" })).toBe("Version 1.2.0");
    expect(createTranslator("en", "en-US").t("taskList.handled", { count: 12345 })).toBe("Handled (12,345)");
    expect(createTranslator("de").t("taskList.handled", { count: 12345 })).toMatch(/12\.345/);
  });

  it("chooses the plural form by the language's own rules", () => {
    const en = createTranslator("en");
    expect(en.t("bulk.selected", { count: 1 })).toBe("1 task selected");
    expect(en.t("bulk.selected", { count: 2 })).toBe("2 tasks selected");
    const ru = new Intl.PluralRules("ru");
    expect(["one", "few", "many"].map((form) => form)).toContain(ru.select(21));
  });

  it("renders a message placed inside another message in the same language", () => {
    const en = createTranslator("en");
    const inner = message("move.destDeleted");
    expect(en.text(message("move.partial", { reason: inner }))).toBe(
      "Some selected tasks were moved before the operation stopped.\n\nThe destination file no longer exists. No tasks were moved.",
    );
  });

  it("puts markup into placeholders for rich text", () => {
    const parts = createTranslator("en").rich("about.version", { version: "V" }) as unknown[];
    const filled = parts.map((part) =>
      isValidElement(part) ? (part as ReactElement<{ children: unknown }>).props.children : part,
    );
    expect(filled.join("")).toBe("Version V");
  });

  it("formats dates, calendar dates, percentages and lists for the locale", () => {
    const en = createTranslator("en", "en-US");
    expect(en.dateTime(new Date("2026-06-04T20:00:00Z"), "UTC")).toBe("Jun 4, 2026, 8:00 PM");
    expect(en.calendarDate(2026, 6, 4)).toBe("Jun 4, 2026");
    expect(en.percent(1.1)).toBe("110%");
    expect(en.list(["Work", "Home", "Garden"])).toBe("Work, Home, Garden");
    expect(createTranslator("ja").list(["仕事", "家"])).toBe("仕事、家");
  });

  it("shows a key the catalogue lacks instead of failing the render", () => {
    // Types keep this out of the app; a stale build or a half-merged catalogue
    // could still reach it, and a window must not go down over one string.
    const missing = "gone.missing" as unknown as MessageKey;
    expect(createTranslator("ja").t(missing)).toBe("gone.missing");
  });
});
