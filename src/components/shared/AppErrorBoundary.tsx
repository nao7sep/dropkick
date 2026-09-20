import { Component, type ReactNode } from "react";
import { log, toErrorFields } from "../../repositories";
import { documentTranslator } from "../../i18n/I18nContext";

/** Last-resort renderer recovery used at the root and around independently replaceable panes. */
export class AppErrorBoundary extends Component<
  { children: ReactNode; onReload?: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    log.error("renderer view failed", toErrorFields(error));
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // The root boundary sits outside the language provider, so every boundary
    // speaks the language the document last declared.
    const { t } = documentTranslator();
    return (
      <main className="flex h-full items-center justify-center p-8" role="alert">
        <section className="max-w-md rounded-lg bg-danger-surface p-6">
          <h1 className="mb-2 font-bold text-danger">{t("crash.title")}</h1>
          <p className="text-sm text-danger">{t("crash.body")}</p>
          <button
            type="button"
            // Reloading destroys nothing, so it is the app's primary action and not
            // a red one: red on what does no harm teaches the colour to mean
            // nothing. The card around it still says what went wrong in red.
            // As a red fill it was also the one button in the app outside the
            // token system — `bg-danger` is the TEXT red, which in the dark theme
            // is a pale one, so white on it measured 2.77:1.
            className="mt-4 rounded-md bg-primary-solid px-3 py-2 text-sm font-semibold text-ink-inverted hover:bg-primary-solid-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ring"
            onClick={this.props.onReload ?? (() => window.location.reload())}
          >
            {t("crash.reload")}
          </button>
        </section>
      </main>
    );
  }
}
