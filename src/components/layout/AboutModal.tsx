// About dialog — shows app name, version, author, and license.

import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import { AppModal } from "../shared/AppModal";
import { InlineResult } from "../shared/InlineResult";
import { Button } from "../shared/Button";
import { log, toErrorFields } from "../../repositories";
import { useI18n } from "../../i18n/I18nContext";
import { message, type Message } from "../../i18n/translate";

interface AboutModalProps {
  onClose: () => void;
}

export function AboutModal({ onClose }: AboutModalProps) {
  const { t } = useI18n();
  const [version, setVersion] = useState<string | null>(null);
  const [versionUnavailable, setVersionUnavailable] = useState(false);
  const [linkErrors, setLinkErrors] = useState<Partial<Record<"repository" | "issues", Message>>>({});
  const linkAttempts = useRef<Record<"repository" | "issues", number>>({ repository: 0, issues: 0 });
  useEffect(() => {
    getVersion()
      .then((value) => setVersion(value))
      .catch((error) => {
        log.warn("get app version failed", toErrorFields(error));
        setVersionUnavailable(true);
      });
  }, []);

  const openProjectLink = async (owner: "repository" | "issues", url: string): Promise<void> => {
    const attempt = ++linkAttempts.current[owner];
    try {
      await openUrl(url);
      if (linkAttempts.current[owner] !== attempt) return;
      setLinkErrors((current) => {
        const next = { ...current };
        delete next[owner];
        return next;
      });
    } catch (error) {
      log.warn("open url failed", { url, ...toErrorFields(error) });
      if (linkAttempts.current[owner] !== attempt) return;
      setLinkErrors((current) => ({
        ...current,
        [owner]: message(owner === "repository" ? "about.githubFailed.body" : "about.issuesFailed.body"),
      }));
    }
  };

  return (
    <AppModal
      title={t("about.title")}
      onClose={onClose}
      describedById="about-modal-description"
      // The width at which the Japanese introduction line lands at about 2.5
      // lines (3, the last about half full) reads as a comfortable card in
      // every language, with no line stranding a single short fragment
      // (about-size rule).
      maxWidth={418}
      passiveBodyLabel={t("about.title")}
      // The name leads the body, so the title band carries only the close
      // control and the title stays the dialog's spoken name.
      titleVisuallyHidden
      bodyClassName="overflow-y-auto px-6 pb-5 pt-0"
      footer={
        <Button onClick={onClose}>{t("common.close")}</Button>
      }
    >
      <p className="text-2xl font-bold leading-tight text-ink-strong">Dropkick</p>
      <p className="mt-1 text-sm text-ink-muted">
        {version
          ? t("about.version", { version })
          : t(versionUnavailable ? "about.versionUnavailable" : "about.versionLoading")}
      </p>
      <p id="about-modal-description" className="mt-4 text-sm text-ink-soft">
        {t("about.tagline")}
      </p>
      <div className="mt-4 flex justify-start gap-4">
        <button
          onClick={() => void openProjectLink("repository", "https://github.com/nao7sep/dropkick")}
          className="inline-flex items-center gap-1 rounded-sm text-sm text-primary hover:text-primary-hover hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ring"
        >
          GitHub
          <ExternalLink size={12} />
        </button>
        <button
          onClick={() => void openProjectLink("issues", "https://github.com/nao7sep/dropkick/issues")}
          className="inline-flex items-center gap-1 rounded-sm text-sm text-primary hover:text-primary-hover hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ring"
        >
          {t("about.reportIssue")}
          <ExternalLink size={12} />
        </button>
      </div>
      {linkErrors.repository ? (
        <InlineResult
          title={message("about.githubFailed.title")}
          message={linkErrors.repository}
          className="mt-4 text-left"
          onDismiss={() => setLinkErrors((current) => {
            const next = { ...current };
            delete next.repository;
            return next;
          })}
        />
      ) : null}
      {linkErrors.issues ? (
        <InlineResult
          title={message("about.issuesFailed.title")}
          message={linkErrors.issues}
          className="mt-4 text-left"
          onDismiss={() => setLinkErrors((current) => {
            const next = { ...current };
            delete next.issues;
            return next;
          })}
        />
      ) : null}
      <p className="mt-4 text-xs text-ink-muted">
        &copy; 2026 Yoshinao Inoguchi
      </p>
      <p className="mt-1 text-xs text-ink-muted">{t("about.license")}</p>
    </AppModal>
  );
}
