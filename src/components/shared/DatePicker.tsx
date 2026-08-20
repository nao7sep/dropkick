// Date picker with popover calendar.
// Shows "No due date" when empty. Supports clearing.
// Uses Radix Popover to portal the calendar outside overflow-clipping ancestors.

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker } from "react-day-picker";
import { Calendar, X } from "lucide-react";
import "react-day-picker/style.css";
import { usePreferencesStore } from "../../state/preferences-store";
import { todayInTimezone } from "../../utils";

interface DatePickerProps {
  value: string | null; // "YYYY-MM-DD" or null
  onChange: (value: string | null) => void;
  isOverdue?: boolean;
  /** Preferred side for the calendar popover. Default: "bottom". */
  popoverPosition?: "bottom" | "top";
}

// Parse "YYYY-MM-DD" to a local Date (noon to avoid timezone edge cases).
function parseDate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

// Format a Date to "YYYY-MM-DD".
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function DatePicker({ value, onChange, isOverdue, popoverPosition = "bottom" }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  // "Today" is a preference, not an OS fact. Every other date decision in the
  // app — the group a task falls in, whether it is overdue, what Cmd+D sets —
  // resolves against preferences.timezone, so the ringed cell has to as well.
  // With the preference set to a zone on a different calendar date, the same
  // New Task modal otherwise showed two different todays, and clicking the
  // ringed one filed a brand-new task straight into Past Due.
  const timezone = usePreferencesStore((s) => s.preferences.timezone);
  const today = parseDate(todayInTimezone(timezone));

  const selected = value ? parseDate(value) : undefined;

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      onChange(formatDate(date));
    }
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setOpen(false);
  };

  const interactiveLayerProps = open
    ? { "data-dropkick-interactive-layer": "" }
    : {};

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <span {...interactiveLayerProps}>
        <Popover.Trigger asChild>
          <button
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm transition-colors hover:bg-background ${
              isOverdue
                ? "border-danger-border-strong text-danger"
                : value
                  ? "border-border text-ink"
                  : "border-border text-ink-soft"
            }`}
          >
            <Calendar size={14} />
            {value ?? "No due date"}
          </button>
        </Popover.Trigger>
      </span>

      <Popover.Portal>
        {/* z-[60] sits above AppModal content (z-[51]) — this picker opens from
            inside the New Task modal — but below the alert dialogs (z-[100]+),
            which can interrupt any layer. Portaled to body, so it shares the
            modal's stacking context and these z-indexes compare directly. */}
        <Popover.Content
          data-dropkick-interactive-layer=""
          side={popoverPosition}
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-[60] rounded-lg border border-border bg-surface p-2 text-ink shadow-lg"
        >
          {/* react-day-picker ships its own blue accent and inherits text color
              from the page (black) — both fail in dark mode. Map its accent vars
              to our primary token (chevrons, today, selected border) and let day
              numbers inherit the popover's text-ink. Inline vars reference the
              bare runtime tokens since @theme inline doesn't emit --color-*. */}
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={handleSelect}
            today={today}
            defaultMonth={selected ?? today}
            style={
              {
                "--rdp-accent-color": "var(--primary)",
                "--rdp-accent-background-color": "var(--primary-surface)",
                "--rdp-today-color": "var(--primary)",
              } as React.CSSProperties
            }
          />
          {value && (
            <div className="border-t border-border-subtle pt-2">
              <button
                onClick={handleClear}
                className="flex w-full items-center justify-center gap-1 rounded-md py-1.5 text-xs text-ink-soft hover:bg-background hover:text-ink"
              >
                <X size={12} />
                Clear due date
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
