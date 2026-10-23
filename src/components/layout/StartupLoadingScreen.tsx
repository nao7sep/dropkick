import { useI18n } from "../../i18n/I18nContext";
import { Button } from "../shared/Button";

export function StartupLoadingScreen({ path, onChooseAnother }: { path: string; onChooseAnother: () => void }) {
  const { t } = useI18n();
  return <div className="flex h-screen items-center justify-center bg-background">
    <div className="max-w-md p-6">
      <p role="status">{t("startup.openingWorkspace")}</p>
      <p className="my-4 break-all text-sm text-ink-soft">{path}</p>
      <Button onClick={onChooseAnother}>{t("startup.chooseAnotherWorkspace")}</Button>
    </div>
  </div>;
}
