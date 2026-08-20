// A cluster of editing controls that reads as one bar, and behaves as one.
//
// The convention's Toolbar pattern: the group is a single tab stop, and arrows
// move within it. Left as plain buttons, a bar of N controls is N page tab
// stops — and the reorder bar's width is a user preference, so every kick
// distance the user adds costs another Tab press to reach the field below it.
//
// Roving tabindex is applied over the bar's own buttons rather than threaded
// through refs, because the children vary per surface and in number: the
// controls are whatever the caller renders, and the bar should not need to know
// what they are.

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { stepIndex } from "../../utils";

export function Toolbar({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const controls = () =>
    Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>(
        "button:not([disabled])",
      ) ?? [],
    );

  // Exactly one control is in the page tab order at a time. Runs on every
  // render because the set changes with the kick distances.
  useEffect(() => {
    const buttons = controls();
    const focused = buttons.findIndex((b) => b === document.activeElement);
    const active = focused === -1 ? 0 : focused;
    buttons.forEach((button, i) => {
      button.tabIndex = i === active ? 0 : -1;
    });
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const buttons = controls();
    const current = buttons.findIndex((b) => b === document.activeElement);
    if (current === -1) return;

    let next: number | null = null;
    if (e.key === "ArrowRight") next = stepIndex(current, 1, buttons.length);
    else if (e.key === "ArrowLeft") next = stepIndex(current, -1, buttons.length);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = buttons.length - 1;
    if (next === null) return;

    e.preventDefault();
    buttons.forEach((button, i) => {
      button.tabIndex = i === next ? 0 : -1;
    });
    buttons[next].focus();
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={className}
    >
      {children}
    </div>
  );
}
