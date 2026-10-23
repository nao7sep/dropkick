// Settings modal — edits preferences (font, timezone, kick distances, etc.).
// Opens from the hamburger menu in the tab bar. Changes are staged locally and saved only on "Save".

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { readSystemTheme } from "../../repositories";
import { usePreferencesStore } from "../../state/preferences-store";
import {
  DUE_SOON_DAYS_MAX,
  DUE_SOON_DAYS_MIN,
  HANDLED_TASKS_PAGE_SIZE_MAX,
  HANDLED_TASKS_PAGE_SIZE_MIN,
  type ThemePreference,
} from "../../models";
import { useComposing, isComposingKeyboardEvent } from "../../hooks/useComposing";
import { useDirtyClose } from "../../hooks/useDirtyClose";
import { SYSTEM_TIME_ZONE, systemTimeZone, timeZoneOptions } from "../../utils/timezone";
import { useI18n } from "../../i18n/I18nContext";
import type { MessageKey } from "../../i18n/catalogues";
import { message, type Message } from "../../i18n/translate";
import { LANGUAGE_NAMES, LANGUAGES, languageName, normalizeLanguagePreference } from "../../i18n/languages";
import { useLanguageStore } from "../../state/language-store";
import { AppModal } from "../shared/AppModal";
import { Button } from "../shared/Button";
import {
  hasPrimaryShortcutModifier,
  singleLine,
  shadowsMacTextBinding,
  isEditableTarget,
} from "../../utils";
import {
  isPreferencesDraftDirty,
  parseKickDistances,
  parseNumericPreference,
  stagedPreferences,
  type StagedPreferences,
} from "../../services/preferences-draft";

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: MessageKey }> = [
  { value: "system", label: "settings.themeSystem" },
  { value: "light", label: "settings.themeLight" },
  { value: "dark", label: "settings.themeDark" },
];

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const fieldId = useId();
  const preferences = usePreferencesStore((s) => s.preferences);
  const systemLanguage = useLanguageStore((s) => s.systemLanguage);
  // System names what it resolves to now, as the time zone's System does
  // (app-chrome-conventions, Theme).
  const [systemTheme, setSystemTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    let current = true;
    void readSystemTheme().then((theme) => {
      if (current) setSystemTheme(theme);
    });
    return () => {
      current = false;
    };
  }, []);
  const update = usePreferencesStore((s) => s.update);
  const composing = useComposing();
  const i18n = useI18n();
  const { t, text } = i18n;

  // Local draft state — everything is edited locally, saved on "Save".
  const [draft, setDraft] = useState<StagedPreferences>(() =>
    stagedPreferences(preferences),
  );
  const [kickInput, setKickInput] = useState(
    preferences.kickDistances.join(", "),
  );
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<Message | null>(null);
  // Offered once per opening: the platform's zone list does not change while
  // the modal is open.
  const [zones] = useState(() => timeZoneOptions(preferences.timezone));

  const isDirty = useMemo(
    () => isPreferencesDraftDirty(draft, preferences, kickInput),
    [draft, preferences, kickInput],
  );

  const dueSoonDays = parseNumericPreference("dueSoonDays", draft.dueSoonDays);
  const handledTasksPageSize = parseNumericPreference("handledTasksPageSize", draft.handledTasksPageSize);
  const validNumbers = dueSoonDays !== null && handledTasksPageSize !== null;

  const handleSave = async () => {
    // Mirror the Save button's disabled state: an explicit commit requires both
    // dirty and valid, so Cmd+Enter is a no-op when there is nothing to save.
    if (!isDirty || !validNumbers || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      setActionError(null);

      const result = await update({
        ...draft,
        fontFamily: singleLine(draft.fontFamily),
        kickDistances: parseKickDistances(kickInput),
        dueSoonDays,
        handledTasksPageSize,
      });
      // A failed write leaves the draft on screen with its message, rather than
      // closing over settings that never reached disk.
      if (result.status === "error") {
        setActionError(message("settings.saveFailed"));
        return;
      }
      onClose();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  // Single close guard for every close path (X, Cancel, Escape, backdrop).
  const closeDirty = useDirtyClose(isDirty, onClose);
  const handleRequestClose = () => { if (!submittingRef.current) closeDirty(); };

  const setField = <K extends keyof StagedPreferences>(
    key: K,
    value: StagedPreferences[K],
  ) => {
    if (submittingRef.current) return;
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <AppModal
      title={t("settings.title")}
      onClose={onClose}
      onRequestClose={handleRequestClose}
      maxWidth={448}
      bodyClassName="space-y-5 overflow-y-auto px-6 py-5"
      footer={
        <>
          <Button onClick={handleRequestClose} disabled={submitting}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={handleSave} disabled={!isDirty || !validNumbers || submitting}>
            {t("settings.save")}
          </Button>
        </>
      }
      contentProps={{
        onKeyDown: (e) => {
          if (hasPrimaryShortcutModifier(e) && e.key === "Enter") {
            if (shadowsMacTextBinding(e) && isEditableTarget(e.target as HTMLElement | null)) return;
            if (isComposingKeyboardEvent(composing.composingRef, e)) return;
            e.preventDefault();
            handleSave();
          }
        },
        ...composing.handlers,
      }}
    >
      {actionError ? (
        <p role="alert" className="text-sm text-danger">
          {text(actionError)}
        </p>
      ) : null}

      {/* Each language is listed by its own name, in its own script, so a
          reader of any of them can find it whatever language is showing. */}
      <Field label={t("settings.language")} htmlFor={`${fieldId}-language`}>
        <select
          id={`${fieldId}-language`}
          disabled={submitting}
          value={draft.language}
          onChange={(e) => setField("language", normalizeLanguagePreference(e.target.value))}
          className="dk-field w-full"
        >
          {/* System names the language it resolves to now, in the
              interface language (localization-conventions, Translation). */}
          <option value="system">
            {t("settings.languageSystemNow", { language: languageName(systemLanguage, i18n.language) })}
          </option>
          {LANGUAGES.map((language) => (
            <option key={language} value={language} lang={language}>
              {LANGUAGE_NAMES[language]}
            </option>
          ))}
        </select>
      </Field>

      {/* Theme — a native radio group (one tab stop, arrow keys move and
          select; composite-control conventions), staged and applied on Save
          like every other field here. */}
      <fieldset className="min-w-0">
        <legend className="dk-label">
          {t("settings.theme")}
        </legend>
        <div className="flex min-h-8 flex-wrap items-center gap-x-5 gap-y-1">
          {THEME_OPTIONS.map(({ value, label }) => (
            <label key={value} className="flex items-center gap-2 text-sm text-ink">
              <input
                disabled={submitting}
                type="radio"
                name="theme"
                value={value}
                checked={draft.theme === value}
                onChange={() => setField("theme", value)}
              />
              {value === "system" && systemTheme
                ? t("settings.themeSystemNow", {
                    theme: t(systemTheme === "dark" ? "settings.themeDark" : "settings.themeLight"),
                  })
                : t(label)}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs leading-5 text-ink-muted">
          {t("settings.themeHint")}
        </p>
      </fieldset>

      {/* Font family */}
      <Field label={t("settings.font")} htmlFor={`${fieldId}-font`}>
        <input
          id={`${fieldId}-font`}
          disabled={submitting}
          type="text"
          value={draft.fontFamily}
          placeholder={t("settings.fontPlaceholder")}
          onChange={(e) => setField("fontFamily", e.target.value)}
          className="dk-field w-full"
        />
        <p className="mt-1.5 text-xs leading-5 text-ink-muted">
          {t("settings.fontHint")}
        </p>
      </Field>

      {/* Time zone — chosen from the list, never typed. System follows the
          computer's zone on every launch. */}
      <Field label={t("settings.timezone")} htmlFor={`${fieldId}-timezone`}>
        <select
          id={`${fieldId}-timezone`}
          disabled={submitting}
          value={draft.timezone}
          onChange={(e) => setField("timezone", e.target.value)}
          className="dk-field w-full"
        >
          <option value={SYSTEM_TIME_ZONE}>{t("settings.timezoneSystem", { zone: systemTimeZone() })}</option>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </Field>

      {/* Kick distances */}
      <Field label={t("settings.kickDistances")} htmlFor={`${fieldId}-kick`}>
        <input
          id={`${fieldId}-kick`}
          disabled={submitting}
          type="text"
          value={kickInput}
          onChange={(e) => { if (!submittingRef.current) setKickInput(e.target.value); }}
          placeholder="5, 25"
          className="dk-field w-full"
        />
        <p className="mt-1.5 text-xs leading-5 text-ink-muted">
          {t("settings.kickDistancesHint", { kick: message("action.kick") })}
        </p>
      </Field>

      {/* Due soon window */}
      <Field label={t("settings.dueSoon")} htmlFor={`${fieldId}-due`}>
        <input
          id={`${fieldId}-due`}
          disabled={submitting}
          type="number"
          min={DUE_SOON_DAYS_MIN}
          max={DUE_SOON_DAYS_MAX}
          aria-invalid={dueSoonDays === null}
          aria-describedby={dueSoonDays === null ? `${fieldId}-due-error` : undefined}
          value={draft.dueSoonDays}
          onChange={(e) => setField("dueSoonDays", e.target.value)}
          className="dk-field w-24"
        />
        {dueSoonDays === null && <p id={`${fieldId}-due-error`} className="mt-1.5 text-xs text-danger">{t("settings.numberRange", { min: DUE_SOON_DAYS_MIN, max: DUE_SOON_DAYS_MAX })}</p>}
        <p className="mt-1.5 text-xs leading-5 text-ink-muted">
          {t("settings.dueSoonHint", { group: message("group.dueSoon") })}
        </p>
      </Field>

      {/* Handled tasks page size */}
      <Field label={t("settings.handledPageSize")} htmlFor={`${fieldId}-handled`}>
        <input
          id={`${fieldId}-handled`}
          disabled={submitting}
          type="number"
          min={HANDLED_TASKS_PAGE_SIZE_MIN}
          max={HANDLED_TASKS_PAGE_SIZE_MAX}
          aria-invalid={handledTasksPageSize === null}
          aria-describedby={handledTasksPageSize === null ? `${fieldId}-handled-error` : undefined}
          value={draft.handledTasksPageSize}
          onChange={(e) => setField("handledTasksPageSize", e.target.value)}
          className="dk-field w-24"
        />
        {handledTasksPageSize === null && <p id={`${fieldId}-handled-error`} className="mt-1.5 text-xs text-danger">{t("settings.numberRange", { min: HANDLED_TASKS_PAGE_SIZE_MIN, max: HANDLED_TASKS_PAGE_SIZE_MAX })}</p>}
      </Field>

      {/* Permanent deletion safety */}
      <Field label={t("settings.deletion")}>
        <label className="flex min-h-8 items-center gap-2 text-sm text-ink">
          <input
            disabled={submitting}
            type="checkbox"
            checked={draft.confirmPermanentDeletions}
            onChange={(e) =>
              setField("confirmPermanentDeletions", e.target.checked)
            }
            className="h-4 w-4"
          />
          {t("settings.confirmDeletions")}
        </label>
        <p className="mt-1.5 text-xs leading-5 text-ink-muted">
          {t("settings.confirmDeletionsHint")}
        </p>
      </Field>
    </AppModal>
  );
}

// Small helper to keep the form layout DRY.
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {htmlFor ? <label className="dk-label" htmlFor={htmlFor}>{label}</label> : <div className="dk-label">{label}</div>}
      {children}
    </div>
  );
}
