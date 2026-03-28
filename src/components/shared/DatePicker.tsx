// Date picker with popover calendar.
// Shows "No due date" when empty. Supports clearing.

import { useState, useRef, useEffect } from "react";
import { DayPicker } from "react-day-picker";
import { Calendar, X } from "lucide-react";
import "react-day-picker/style.css";

interface DatePickerProps {
  value: string | null; // "YYYY-MM-DD" or null
  onChange: (value: string | null) => void;
  isOverdue?: boolean;
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

export function DatePicker({ value, onChange, isOverdue }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

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

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm transition-colors hover:bg-gray-50 ${
          isOverdue
            ? "border-red-300 text-red-600"
            : value
              ? "border-gray-200 text-gray-700"
              : "border-gray-200 text-gray-400"
        }`}
      >
        <Calendar size={14} />
        {value ?? "No due date"}
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={handleSelect}
            defaultMonth={selected}
          />
          {value && (
            <div className="border-t border-gray-100 pt-2">
              <button
                onClick={handleClear}
                className="flex w-full items-center justify-center gap-1 rounded-md py-1.5 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              >
                <X size={12} />
                Clear due date
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
