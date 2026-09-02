import { AlertCircle, X } from "lucide-react";

interface InlineResultProps {
  title: string;
  message: string;
  className?: string;
  onDismiss?: () => void;
  id?: string;
}

export function InlineResult({
  title,
  message,
  className = "",
  onDismiss,
  id,
}: InlineResultProps) {
  return (
    <div
      role="alert"
      id={id}
      className={`flex items-start gap-2 rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-fg-strong ${className}`}
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{title}</div>
        <div className="whitespace-pre-wrap">{message}</div>
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={`Dismiss ${title.toLowerCase()}`}
          className="shrink-0 rounded p-0.5 text-danger hover:bg-danger-surface-strong"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}
