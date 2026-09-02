// About dialog — shows app name, version, author, and license.

import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import { AppModal } from "../shared/AppModal";
import { InlineResult } from "../shared/InlineResult";
import { log, toErrorFields } from "../../repositories";

interface AboutModalProps {
  onClose: () => void;
}

export function AboutModal({ onClose }: AboutModalProps) {
  const [version, setVersion] = useState<string | null>(null);
  const [versionUnavailable, setVersionUnavailable] = useState(false);
  const [linkErrors, setLinkErrors] = useState<Partial<Record<"repository" | "issues", string>>>({});
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
        [owner]: owner === "repository"
          ? "Open the project page in your browser and try again."
          : "Open the issues page in your browser and try again.",
      }));
    }
  };

  return (
    <AppModal
      title="About Dropkick"
      onClose={onClose}
      describedById="about-modal-description"
      maxWidth={320}
      bodyClassName="overflow-y-auto px-6 py-5 text-center"
      footerClassName="flex justify-end border-t border-border px-6 py-4"
      footer={
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm text-ink-soft hover:bg-background"
          >
            Close
          </button>
      }
    >
      <p className="text-2xl font-bold text-ink-strong">Dropkick</p>
      <p className="mt-1 text-sm text-ink-muted">
        {version ? `Version ${version}` : versionUnavailable ? "Version unavailable" : "Loading version…"}
      </p>
      <p id="about-modal-description" className="mt-4 text-sm text-ink-soft">
        A local-first task manager for working with plain JSON task lists
        across multiple files. Your data stays on your machine.
      </p>
      <div className="mt-4 flex justify-center gap-4">
        <button
          onClick={() => void openProjectLink("repository", "https://github.com/nao7sep/dropkick")}
          className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary-hover hover:underline"
        >
          GitHub
          <ExternalLink size={12} />
        </button>
        <button
          onClick={() => void openProjectLink("issues", "https://github.com/nao7sep/dropkick/issues")}
          className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary-hover hover:underline"
        >
          Report Issue
          <ExternalLink size={12} />
        </button>
      </div>
      {linkErrors.repository ? (
        <InlineResult
          title="GitHub not opened"
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
          title="Report Issue not opened"
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
      <p className="mt-1 text-xs text-ink-muted">MIT License</p>
    </AppModal>
  );
}
