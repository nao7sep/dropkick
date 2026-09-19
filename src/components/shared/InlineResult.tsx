import { X } from "lucide-react";
import { useI18n } from "../../i18n/I18nContext";
import type { Message } from "../../i18n/translate";

interface InlineResultProps {
  title: Message;
  message: Message;
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
  const { t, text } = useI18n();
  const heading = text(title);
  return (
    <div
      role="alert"
      id={id}
      className={`flex items-start gap-2 rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-fg-strong ${className}`}
    >
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{heading}</div>
        <div className="whitespace-pre-wrap">{text(message)}</div>
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("common.dismissNamed", { title: heading })}
          className="shrink-0 rounded p-0.5 text-danger hover:bg-danger-surface-strong focus-visible:bg-danger-surface-strong"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}
