// Root setup surface; no user documents are written until Create and open.
import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { createInitialDocuments, getSuggestedSetupDirectory } from "../../repositories/first-run";
import { log, showMessage, toErrorFields } from "../../repositories";
import { useAppConfigStore } from "../../state/app-config-store";
import { useI18n } from "../../i18n/I18nContext";
import { message } from "../../i18n/translate";
import { AppModal } from "../shared/AppModal";
import { Button } from "../shared/Button";

export function FirstRunSetup({ onLaunch, onExisting, onQuit }: {
  onLaunch: (preferences: string, workspace: string) => Promise<void>;
  onExisting: () => void;
  onQuit: () => void;
}) {
  const { t } = useI18n();
  const [directory, setDirectory] = useState("");
  const [includeTaskList, setIncludeTaskList] = useState(true);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  useEffect(() => {
    let disposed = false;
    void getSuggestedSetupDirectory().then((path) => {
      if (!disposed) setDirectory(path);
    }).catch((error) => log.warn("setup suggestion unavailable", toErrorFields(error)));
    return () => { disposed = true; };
  }, []);
  async function chooseFolder() {
    try {
      const path = await open({ directory: true, multiple: false, defaultPath: directory || undefined });
      if (typeof path === "string") setDirectory(path);
    } catch (error) {
      log.warn("setup folder picker failed", toErrorFields(error));
      await showMessage(message("setup.failed.title"), message("setup.failed.body"));
    }
  }
  async function create() {
    if (running.current || !directory) return;
    running.current = true;
    setBusy(true);
    try {
      const files = await createInitialDocuments(directory, includeTaskList, {
        preferences: t("startup.preferences"), workspace: t("startup.workspace"), taskList: t("setup.taskListName"),
      });
      const config = useAppConfigStore.getState();
      await config.register("preferences", files.preferencesPath);
      await config.register("workspace", files.workspacePath);
      await onLaunch(files.preferencesPath, files.workspacePath);
    } catch (error) {
      log.error("first setup failed", toErrorFields(error));
      await showMessage(message("setup.failed.title"), message("setup.failed.body"));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return <>
    <div className="fixed inset-0 bg-background" />
    <AppModal title={t("setup.title")} onClose={() => {}} closable={false} dimmed={false} maxWidth={520}
      footerClassName="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4"
      footer={<>
        <Button onClick={onQuit}>{t("startup.quit")}</Button>
        <Button variant="primary" disabled={busy || !directory} onClick={() => void create()}>{t("setup.create")}</Button>
      </>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">{t("setup.body")}</p>
        <div>
          <span className="block text-sm font-semibold text-ink">{t("setup.location")}</span>
          <p className="my-2 break-all text-sm text-ink-soft">{directory}</p>
          <Button disabled={busy} onClick={() => void chooseFolder()}>{t("setup.chooseFolder")}</Button>
        </div>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={includeTaskList} disabled={busy} onChange={(event) => setIncludeTaskList(event.target.checked)} />
          {t("setup.firstTaskList")}
        </label>
        <Button disabled={busy} onClick={onExisting}>{t("setup.existing")}</Button>
      </div>
    </AppModal>
  </>;
}
