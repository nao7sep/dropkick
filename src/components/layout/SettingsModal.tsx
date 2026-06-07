// Settings modal — edits preferences (font, date/time format, timezone, kick distances, etc.).
// Opens from a gear icon in the tab bar. Changes are staged locally and saved only on "Save".

import { useRef, useMemo, useState } from "react";
import { usePreferencesStore } from "../../state/preferences-store";
import type { PreferencesDto } from "../../models";
import { DATE_FORMATS, isDateFormat } from "../../models";
import { useComposing, isComposingKeyboardEvent } from "../../hooks/useComposing";
import { validateTimezone } from "../../utils/timezone";
import { AppModal } from "../shared/AppModal";
import { hasPrimaryShortcutModifier } from "../../utils";
import { showUnsavedChangesConfirm } from "../../repositories";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const preferences = usePreferencesStore((s) => s.preferences);
  const update = usePreferencesStore((s) => s.update);
  const composing = useComposing();

  // Local draft state — everything is edited locally, saved on "Save".
  const [draft, setDraft] = useState<PreferencesDto>({ ...preferences });
  const [kickInput, setKickInput] = useState(
    preferences.kickDistances.join(", "),
  );
  const timezoneRef = useRef<HTMLInputElement>(null);

  const timezoneValidation = validateTimezone(draft.timezone);
  const timezoneError = timezoneValidation.valid
    ? null
    : "Invalid IANA timezone";

  const isDirty = useMemo(() => {
    if (kickInput !== preferences.kickDistances.join(", ")) return true;
    // Exclude zoomLevel and sidebarWidth — they are controlled outside this modal
    // (keyboard shortcuts / drag divider) and must not be compared against the draft.
    const keys = (Object.keys(preferences) as (keyof PreferencesDto)[])
      .filter((k) => k !== "zoomLevel" && k !== "sidebarWidth");
    return keys.some((k) => draft[k] !== preferences[k]);
  }, [draft, kickInput, preferences]);

  const handleSave = async () => {
    if (!timezoneValidation.valid) return;

    // Parse kick distances from comma-separated string.
    const parsed = kickInput
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0)
      .map((n) => Math.min(n, 999));
    const deduplicated = [...new Set(parsed)];
    const kickDistances = deduplicated.length > 0 ? deduplicated : [5, 25];

    await update({
      ...draft,
      // Use live values — these are controlled outside this modal.
      zoomLevel: preferences.zoomLevel,
      sidebarWidth: preferences.sidebarWidth,
      timezone: timezoneValidation.value,
      kickDistances,
    });
    onClose();
  };

  const handleRequestClose = async () => {
    if (!isDirty) {
      onClose();
      return;
    }
    const discard = await showUnsavedChangesConfirm();
    if (discard) onClose();
  };

  const setField = <K extends keyof PreferencesDto>(
    key: K,
    value: PreferencesDto[K],
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <AppModal
      title="Settings"
      onClose={onClose}
      onRequestClose={handleRequestClose}
      maxWidth={448}
      bodyClassName="space-y-5 overflow-y-auto px-6 py-5"
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm text-ink-soft hover:bg-background"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!timezoneValidation.valid}
            className="rounded-md bg-primary-solid px-4 py-2 text-sm text-ink-inverted hover:bg-primary-solid-hover disabled:bg-background disabled:text-ink-muted"
          >
            Save
          </button>
        </>
      }
      contentProps={{
        onKeyDown: (e) => {
          if (hasPrimaryShortcutModifier(e) && e.key === "Enter") {
            if (isComposingKeyboardEvent(composing.composingRef, e)) return;
            e.preventDefault();
            handleSave();
          }
        },
        onOpenAutoFocus: (e) => {
          if (!timezoneValidation.valid) {
            e.preventDefault();
            timezoneRef.current?.focus();
          }
        },
        ...composing.handlers,
      }}
    >
      {/* Theme */}
      <Field label="Theme">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={draft.darkMode}
            onChange={(e) => setField("darkMode", e.target.checked)}
            className="rounded border-border-strong"
          />
          Dark mode
        </label>
      </Field>

      {/* Font family */}
      <Field label="Font family">
        <input
          type="text"
          value={draft.fontFamily}
          onChange={(e) => setField("fontFamily", e.target.value)}
          className="w-full rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
        />
      </Field>

      {/* Date format */}
      <Field label="Date format">
        <select
          value={draft.dateFormat}
          onChange={(e) => {
            // The options are generated from DATE_FORMATS, so this is always
            // true — but validating (instead of casting) keeps an out-of-set
            // value from ever entering preferences and narrows the type.
            if (isDateFormat(e.target.value)) {
              setField("dateFormat", e.target.value);
            }
          }}
          className="rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
        >
          {DATE_FORMATS.map((fmt) => (
            <option key={fmt} value={fmt}>
              {fmt}
            </option>
          ))}
        </select>
      </Field>

      {/* Time format */}
      <Field label="Time format">
        <select
          value={draft.timeFormat}
          onChange={(e) =>
            setField("timeFormat", e.target.value as "24h" | "12h")
          }
          className="rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
        >
          <option value="24h">24-hour</option>
          <option value="12h">12-hour</option>
        </select>
      </Field>

      {/* Timezone */}
      <Field label="Timezone">
        <div className="flex items-center gap-2">
          <input
            ref={timezoneRef}
            type="text"
            value={draft.timezone ?? ""}
            onChange={(e) => setField("timezone", e.target.value || null)}
            placeholder="System default"
            className="flex-1 rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
          />
          <button
            onClick={() =>
              setField(
                "timezone",
                Intl.DateTimeFormat().resolvedOptions().timeZone,
              )
            }
            className="rounded-md border border-border px-2 py-1.5 text-xs text-ink-muted hover:bg-background"
            title="Use system timezone"
          >
            Detect
          </button>
        </div>
        {timezoneError ? (
          <p className="mt-1 text-xs text-danger">{timezoneError}</p>
        ) : (
          <p className="mt-1 text-xs text-ink-muted">
            IANA timezone (e.g. Asia/Tokyo, America/New_York). Leave empty for
            system default.
          </p>
        )}
      </Field>

      {/* Kick distances */}
      <Field label="Kick distances">
        <input
          type="text"
          value={kickInput}
          onChange={(e) => setKickInput(e.target.value)}
          placeholder="5, 25"
          className="w-full rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
        />
        <p className="mt-1 text-xs text-ink-muted">
          Comma-separated numbers (e.g. 5, 25). "Kick to End" is always
          available.
        </p>
      </Field>

      {/* Due soon window */}
      <Field label="Due soon window">
        <input
          type="number"
          min={1}
          max={365}
          value={draft.dueSoonDays}
          onChange={(e) =>
            setField(
              "dueSoonDays",
              Math.max(1, parseInt(e.target.value, 10) || 7),
            )
          }
          className="w-24 rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
        />
        <p className="mt-1 text-xs text-ink-muted">
          Tasks due within this many days from tomorrow appear in the Due Soon group.
        </p>
      </Field>

      {/* Handled tasks page size */}
      <Field label="Handled tasks page size">
        <input
          type="number"
          min={10}
          max={500}
          value={draft.handledTasksPageSize}
          onChange={(e) =>
            setField(
              "handledTasksPageSize",
              parseInt(e.target.value, 10) || 50,
            )
          }
          className="w-24 rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
        />
      </Field>

      {/* Automatic backup */}
      <Field label="Automatic backup">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={draft.backupEnabled}
            onChange={(e) => setField("backupEnabled", e.target.checked)}
            className="rounded border-border-strong"
          />
          Back up task lists on startup and hourly
        </label>
        <p className="mt-1 text-xs text-ink-muted">
          Backups are saved to ~/.dropkick/backups/ (per workspace) and pruned automatically.
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
