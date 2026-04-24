// Settings modal — edits preferences (font, date/time format, timezone, kick distances, etc.).
// Opens from a gear icon in the tab bar. Changes are staged locally and saved only on "Save".

import { useRef, useMemo, useState } from "react";
import { usePreferencesStore } from "../../state/preferences-store";
import type { PreferencesDto } from "../../models";
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
    const keys = Object.keys(preferences) as (keyof PreferencesDto)[];
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
            className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!timezoneValidation.valid}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
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
      {/* Font family */}
      <Field label="Font family">
        <input
          type="text"
          value={draft.fontFamily}
          onChange={(e) => setField("fontFamily", e.target.value)}
          className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300"
        />
      </Field>

      {/* Zoom level */}
      <Field label="Zoom level">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={50}
            max={200}
            step={10}
            value={Math.round(draft.zoomLevel * 100)}
            onChange={(e) =>
              setField("zoomLevel", parseInt(e.target.value, 10) / 100)
            }
            className="flex-1"
          />
          <span className="w-12 text-right text-sm text-gray-600">
            {Math.round(draft.zoomLevel * 100)}%
          </span>
        </div>
      </Field>

      {/* Sidebar width */}
      <Field label="Sidebar width">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={160}
            max={1280}
            step={10}
            value={draft.sidebarWidth ?? 320}
            onChange={(e) =>
              setField("sidebarWidth", parseInt(e.target.value, 10))
            }
            className="flex-1"
          />
          <span className="w-14 text-right text-sm text-gray-600">
            {draft.sidebarWidth ?? 320}px
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          You can also drag the divider between the task list and detail pane.
        </p>
      </Field>

      {/* Date format */}
      <Field label="Date format">
        <select
          value={draft.dateFormat}
          onChange={(e) => setField("dateFormat", e.target.value)}
          className="rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300"
        >
          <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          <option value="MM/DD/YYYY">MM/DD/YYYY</option>
          <option value="DD/MM/YYYY">DD/MM/YYYY</option>
        </select>
      </Field>

      {/* Time format */}
      <Field label="Time format">
        <select
          value={draft.timeFormat}
          onChange={(e) =>
            setField("timeFormat", e.target.value as "24h" | "12h")
          }
          className="rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300"
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
            className="flex-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300"
          />
          <button
            onClick={() =>
              setField(
                "timezone",
                Intl.DateTimeFormat().resolvedOptions().timeZone,
              )
            }
            className="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
            title="Use system timezone"
          >
            Detect
          </button>
        </div>
        {timezoneError ? (
          <p className="mt-1 text-xs text-red-500">{timezoneError}</p>
        ) : (
          <p className="mt-1 text-xs text-gray-400">
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
          className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300"
        />
        <p className="mt-1 text-xs text-gray-400">
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
          className="w-24 rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300"
        />
        <p className="mt-1 text-xs text-gray-400">
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
          className="w-24 rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300"
        />
      </Field>

      {/* Automatic backup */}
      <Field label="Automatic backup">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={draft.backupEnabled}
            onChange={(e) => setField("backupEnabled", e.target.checked)}
            className="rounded border-gray-300"
          />
          Back up task lists on startup and hourly
        </label>
        <p className="mt-1 text-xs text-gray-400">
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
      <label className="mb-1 block text-xs font-medium text-gray-500">
        {label}
      </label>
      {children}
    </div>
  );
}
