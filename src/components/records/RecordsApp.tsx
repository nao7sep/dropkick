// The Records window's root. It speaks the main window's interface language
// from its first text and follows it, along with the locale and time zone,
// when Settings changes them there.

import { useEffect, useState } from "react";
import { I18nProvider, loadInterfaceCatalogue } from "../../i18n/I18nContext";
import type { RecordsContext } from "../../models/records";
import { onRecordsContext } from "../../repositories/records";
import { initialRecordsWindow } from "../../services/records";
import { RecordsWindow } from "./RecordsWindow";

export function RecordsApp({ search }: { search: string }) {
  const [initial] = useState(() => initialRecordsWindow(search));
  const [context, setContext] = useState<RecordsContext>(initial.context);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let current = true;
    void loadInterfaceCatalogue(initial.context.language).then(() => {
      if (current) setReady(true);
    });
    const unsubscribe = onRecordsContext(setContext);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [initial]);

  // No text until the language is known, so the first words on screen are
  // already in it.
  if (!ready) return <div className="h-screen bg-background" />;

  return (
    <I18nProvider language={context.language} locale={context.locale}>
      <RecordsWindow initialListWidth={initial.listWidth} timeZone={context.timeZone} />
    </I18nProvider>
  );
}
