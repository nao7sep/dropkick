// Settings modal — edits preferences (font, date/time format, timezone, kick distances, etc.).
// Opens from a gear icon in the tab bar. Changes are saved immediately on close.

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { usePreferencesStore } from "../../state/preferences-store";
import type { PreferencesDto } from "../../models";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const preferences = usePreferencesStore((s) => s.preferences);
  const update = usePreferencesStore((s) => s.update);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Local draft state — everything is edited locally, saved on "Save".
  const [draft, setDraft] = useState<PreferencesDto>({ ...preferences });
  const [kickInput, setKickInput] = useState(
    preferences.kickDistances.join(", "),
  );

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Close on backdrop click.
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  const handleSave = async () => {
    // Parse kick distances from comma-separated string.
    const parsed = kickInput
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0)
      .map((n) => Math.min(n, 999));
    const deduplicated = [...new Set(parsed)];
    const kickDistances = deduplicated.length > 0 ? deduplicated : [5, 25];

    await update({ ...draft, kickDistances });
    onClose();
  };

  const setField = <K extends keyof PreferencesDto>(
    key: K,
    value: PreferencesDto[K],
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
    >
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-800">Settings</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 px-6 py-5">
          {/* Font family */}
          <Field label="Font family">
            <input
              type="text"
              value={draft.fontFamily}
              onChange={(e) => setField("fontFamily", e.target.value)}
              className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300"
            />
          </Field>

          {/* Font size */}
          <Field label="Font size (px)">
            <input
              type="number"
              min={10}
              max={24}
              value={draft.fontSize}
              onChange={(e) =>
                setField("fontSize", parseInt(e.target.value, 10) || 14)
              }
              className="w-24 rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300"
            />
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
                type="text"
                value={draft.timezone ?? ""}
                onChange={(e) =>
                  setField("timezone", e.target.value || null)
                }
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
            <p className="mt-1 text-xs text-gray-400">
              IANA timezone (e.g. Asia/Tokyo, America/New_York). Leave empty for
              system default.
            </p>
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
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </div>
    </div>
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
