// The app's one button primitive. A button names its role and size here; the
// anatomy and every state live in App.css's control roles, so one change moves
// the whole app (interface-styling-conventions).
//
// The two destructive roles are distinct on purpose: `danger` is the outlined
// trigger that OPENS a destructive path (Delete in the detail pane), and
// `danger-confirm` is the filled button that COMMITS it in the dialog that asks.
// Nothing that destroys nothing takes either.

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "quiet"
  | "danger"
  | "danger-confirm"
  | "warning-confirm";

export type ButtonSize = "md" | "sm";

export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
): string {
  return `dk-btn dk-btn-${variant}${size === "sm" ? " dk-btn-sm" : ""}`;
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
  }
>(function Button(
  { variant = "secondary", size = "md", className = "", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      {...props}
      className={`${buttonClass(variant, size)} ${className}`.trim()}
    />
  );
});
