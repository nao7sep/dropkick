// Settings modal — edits preferences (font, timezone, kick distances, etc.).
// Opens from the hamburger menu in the tab bar. Changes are staged locally and saved only on "Save".

import { useMemo, useState } from "react";
import { usePreferencesStore } from "../../state/preferences-store";
import {
  DUE_SOON_DAYS_DEFAULT,
  DUE_SOON_DAYS_MAX,
  DUE_SOON_DAYS_MIN,
  HANDLED_TASKS_PAGE_SIZE_DEFAULT,
  HANDLED_TASKS_PAGE_SIZE_MAX,
  HANDLED_TASKS_PAGE_SIZE_MIN,
  normalizeDueSoonDays,
  normalizeHandledTasksPageSize,
  type ThemePreference,
} from "../../models";
import { useComposing, isComposingKeyboardEvent } from "../../hooks/useComposing";
import { useDirtyClose } from "../../hooks/useDirtyClose";
import { systemTimeZone, timeZoneOptions } from "../../utils/timezone";
import { CATALOGUES } from "../../i18n/catalogues";
import { useI18n } from "../../i18n/I18nContext";
import type { MessageKey } from "../../i18n/catalogues";
import { message, type Message } from "../../i18n/translate";
import { LANGUAGES, normalizeLanguagePreference } from "../../i18n/languages";
import { AppModal } from "../shared/AppModal";
import {
  hasPrimaryShortcutModifier,
  singleLine,
  shadowsMacTextBinding,
  isEditableTarget,
} from "../../utils";
import {
  isPreferencesDraftDirty,
  parseKickDistances,
  stagedPreferences,
  type StagedPreferences,
} from "../../services";

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: MessageKey }> = [
  { value: "system", label: "settings.themeSystem" },
  { value: "light", label: "settings.themeLight" },
  { value: "dark", label: "settings.themeDark" },
];

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const preferences = usePreferencesStore((s) => s.preferences);
  const update = usePreferencesStore((s) => s.update);
  const composing = useComposing();
  const { t, text } = useI18n();

  // Local draft state — everything is edited locally, saved on "Save".
  const [draft, setDraft] = useState<StagedPreferences>(() =>
    stagedPreferences(preferences),
  );
  const [kickInput, setKickInput] = useState(
    preferences.kickDistances.join(", "),
  );
  const [actionError, setActionError] = useState<Message | null>(null);
  // Offered once per opening: the platform's zone list does not change while
  // the modal is open.
  const [zones] = useState(() => timeZoneOptions(preferences.timezone));

  const isDirty = useMemo(
    () => isPreferencesDraftDirty(draft, preferences, kickInput),
    [draft, preferences, kickInput],
  );

  const handleSave = async () => {
    // Mirror the Save button's disabled state: an explicit commit requires both
    // dirty and valid, so Cmd+Enter is a no-op when there is nothing to save.
    if (!isDirty) return;
    setActionError(null);

    const result = await update({
      ...draft,
      fontFamily: singleLine(draft.fontFamily),
      kickDistances: parseKickDistances(kickInput),
      // Range-clamp on commit rather than per keystroke, so typing "50" is not
      // fought by the minimum after the first digit. A min/max attribute is not
      // enforced for typed input, and both values reach consumers that cannot
      // recover from an out-of-range one — dueSoonDays feeds date arithmetic,
      // handledTasksPageSize is a slice length.
      dueSoonDays: normalizeDueSoonDays(draft.dueSoonDays),
      handledTasksPageSize: normalizeHandledTasksPageSize(
        draft.handledTasksPageSize,
      ),
    });
    // A failed write leaves the draft on screen with its message, rather than
    // closing over settings that never reached disk.
    if (result.status === "error") {
      setActionError(message("settings.saveFailed"));
      return;
    }
    onClose();
  };

  // Single close guard for every close path (X, Cancel, Escape, backdrop).
  const handleRequestClose = useDirtyClose(isDirty, onClose);

  const setField = <K extends keyof StagedPreferences>(
    key: K,
    value: StagedPreferences[K],
  ) => {
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
          <button
            onClick={handleRequestClose}
            className="rounded-md border border-border px-4 py-2 text-sm text-ink-soft hover:bg-background"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty}
            className="rounded-md bg-primary-solid px-4 py-2 text-sm text-ink-inverted hover:bg-primary-solid-hover disabled:opacity-50"
          >
            {t("settings.save")}
          </button>
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
      <Field label={t("settings.language")}>
        <select
          value={draft.language}
          onChange={(e) => setField("language", normalizeLanguagePreference(e.target.value))}
          className="w-full rounded-md border border-input-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
        >
          <option value="system">{t("settings.languageSystem")}</option>
          {LANGUAGES.map((language) => (
            <option key={language} value={language} lang={language}>
              {CATALOGUES[language]["language.name"] as string}
            </option>
          ))}
        </select>
      </Field>

      {/* Theme — a native radio group (one tab stop, arrow keys move and
          select; composite-control conventions), staged and applied on Save
          like every other field here. */}
      <fieldset className="min-w-0">
        <legend className="mb-1 block text-xs font-medium text-ink-muted">
          {t("settings.theme")}
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {THEME_OPTIONS.map(({ value, label }) => (
            <label key={value} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="theme"
                value={value}
                checked={draft.theme === value}
                onChange={() => setField("theme", value)}
              />
              {t(label)}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          {t("settings.themeHint")}
        </p>
      </fieldset>

      {/* Font family */}
      <Field label={t("settings.font")}>
        <input
          type="text"
          value={draft.fontFamily}
          placeholder={t("settings.fontPlaceholder")}
          onChange={(e) => setField("fontFamily", e.target.value)}
          className="w-full rounded-md border border-input-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
        />
        <p className="mt-1 text-xs text-ink-muted">
          {t("settings.fontHint")}
        </p>
      </Field>

      {/* Time zone — chosen from the list, never typed. System follows the
          computer's zone on every launch. */}
      <Field label={t("settings.timezone")}>
        <select
          value={draft.timezone ?? ""}
          onChange={(e) => setField("timezone", e.target.value || null)}
          className="w-full rounded-md border border-input-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
        >
          <option value="">{t("settings.timezoneSystem", { zone: systemTimeZone() })}</option>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </Field>

      {/* Kick distances */}
      <Field label={t("settings.kickDistances")}>
        <input
          type="text"
          value={kickInput}
          onChange={(e) => setKickInput(e.target.value)}
          placeholder="5, 25"
          className="w-full rounded-md border border-input-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
        />
        <p className="mt-1 text-xs text-ink-muted">
          {t("settings.kickDistancesHint", { kick: message("action.kick") })}
        </p>
      </Field>

      {/* Due soon window */}
      <Field label={t("settings.dueSoon")}>
        <input
          type="number"
          min={DUE_SOON_DAYS_MIN}
          max={DUE_SOON_DAYS_MAX}
          value={draft.dueSoonDays}
          onChange={(e) =>
            setField(
              "dueSoonDays",
              parseInt(e.target.value, 10) || DUE_SOON_DAYS_DEFAULT,
            )
          }
          className="w-24 rounded-md border border-input-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
        />
        <p className="mt-1 text-xs text-ink-muted">
          {t("settings.dueSoonHint", { group: message("group.dueSoon") })}
        </p>
      </Field>

      {/* Handled tasks page size */}
      <Field label={t("settings.handledPageSize")}>
        <input
          type="number"
          min={HANDLED_TASKS_PAGE_SIZE_MIN}
          max={HANDLED_TASKS_PAGE_SIZE_MAX}
          value={draft.handledTasksPageSize}
          onChange={(e) =>
            setField(
              "handledTasksPageSize",
              parseInt(e.target.value, 10) || HANDLED_TASKS_PAGE_SIZE_DEFAULT,
            )
          }
          className="w-24 rounded-md border border-input-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
        />
      </Field>

      {/* Permanent deletion safety */}
      <Field label={t("settings.deletion")}>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={draft.confirmPermanentDeletions}
            onChange={(e) =>
              setField("confirmPermanentDeletions", e.target.checked)
            }
            className="rounded border-border-strong"
          />
          {t("settings.confirmDeletions")}
        </label>
        <p className="mt-1 text-xs text-ink-muted">
          {t("settings.confirmDeletionsHint")}
        </p>
      </Field>
    </AppModal>
  );
}

// Small helper to keep the form layout DRY.
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-ink-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
