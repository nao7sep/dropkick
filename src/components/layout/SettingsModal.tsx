// Settings modal — edits preferences (font, timezone, kick distances, etc.).
// Opens from the hamburger menu in the tab bar. Changes are staged locally and saved only on "Save".

import { useMemo, useRef, useState } from "react";
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
import { validateTimezone } from "../../utils/timezone";
import { showMessage } from "../../repositories";
import { AppModal } from "../shared/AppModal";
import {
  hasPrimaryShortcutModifier,
  primaryModifierLabel,
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

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const preferences = usePreferencesStore((s) => s.preferences);
  const update = usePreferencesStore((s) => s.update);
  const composing = useComposing();

  // Local draft state — everything is edited locally, saved on "Save". Theme
  // is not in the type: it applies live and closing never discards it.
  const [draft, setDraft] = useState<StagedPreferences>(() =>
    stagedPreferences(preferences),
  );
  const [kickInput, setKickInput] = useState(
    preferences.kickDistances.join(", "),
  );
  const timezoneRef = useRef<HTMLInputElement>(null);

  const timezoneValidation = validateTimezone(draft.timezone);
  const timezoneError = timezoneValidation.valid
    ? null
    : "Invalid IANA timezone";

  // Theme cannot be in the draft (see services/preferences-draft), so the
  // dirty check needs no exclusion list.
  const isDirty = useMemo(
    () => isPreferencesDraftDirty(draft, preferences, kickInput),
    [draft, preferences, kickInput],
  );

  const handleSave = async () => {
    // Mirror the Save button's disabled state: an explicit commit requires both
    // dirty and valid, so Cmd+Enter is a no-op when there is nothing to save.
    if (!isDirty || !timezoneValidation.valid) return;

    // Theme is deliberately absent from the draft's type, so leaving it out
    // of this partial is what stops a stale copy reverting a live toggle.
    const result = await update({
      ...draft,
      fontFamily: singleLine(draft.fontFamily),
      timezone: timezoneValidation.value,
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
      await showMessage("Settings Save Failed", result.message);
      return;
    }
    onClose();
  };

  const handleThemeChange = async (theme: ThemePreference) => {
    const result = await update({ theme });
    if (result.status === "error") {
      await showMessage("Theme Save Failed", result.message);
    }
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
      title="Settings"
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
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty || !timezoneValidation.valid}
            className="rounded-md bg-primary-solid px-4 py-2 text-sm text-ink-inverted hover:bg-primary-solid-hover disabled:bg-background disabled:text-ink-muted"
          >
            Save
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
        onOpenAutoFocus: (e) => {
          if (!timezoneValidation.valid) {
            e.preventDefault();
            timezoneRef.current?.focus();
          }
        },
        ...composing.handlers,
      }}
    >
      {/* Theme — applied live (like zoom), so it reads and writes the store
          directly rather than the draft, and stays in sync with the global
          {mod}+Shift+D toggle. */}
      <Field label="Theme">
        <select
          value={preferences.theme}
          onChange={(e) =>
            void handleThemeChange(e.target.value as ThemePreference)
          }
          className="w-full rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
        <p className="mt-1 text-xs text-ink-muted">
          Applied immediately. System follows the OS appearance.{" "}
          {`${primaryModifierLabel}+Shift+D`} switches to the opposite
          appearance.
        </p>
      </Field>

      {/* Font family */}
      <Field label="Font family">
        <input
          type="text"
          value={draft.fontFamily}
          placeholder="System default"
          onChange={(e) => setField("fontFamily", e.target.value)}
          className="w-full rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
        />
        <p className="mt-1 text-xs text-ink-muted">
          Leave empty for the system font. A name that isn't installed falls
          back to it.
        </p>
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
          Comma-separated numbers (e.g. 5, 25). "Kick" is always available.
        </p>
      </Field>

      {/* Due soon window */}
      <Field label="Due soon window">
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
          min={HANDLED_TASKS_PAGE_SIZE_MIN}
          max={HANDLED_TASKS_PAGE_SIZE_MAX}
          value={draft.handledTasksPageSize}
          onChange={(e) =>
            setField(
              "handledTasksPageSize",
              parseInt(e.target.value, 10) || HANDLED_TASKS_PAGE_SIZE_DEFAULT,
            )
          }
          className="w-24 rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
        />
      </Field>

      {/* Permanent deletion safety */}
      <Field label="Deletion">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={draft.confirmPermanentDeletions}
            onChange={(e) =>
              setField("confirmPermanentDeletions", e.target.checked)
            }
            className="rounded border-border-strong"
          />
          Confirm permanent deletions
        </label>
        <p className="mt-1 text-xs text-ink-muted">
          When off, tasks and notes are deleted immediately and cannot be
          restored in Dropkick.
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
