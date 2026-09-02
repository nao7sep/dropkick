import { Component, type ReactNode } from "react";
import { log, toErrorFields } from "../../repositories";

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
    return (
      <main className="flex h-full items-center justify-center p-8" role="alert">
        <section className="max-w-md rounded-lg bg-danger-surface p-6">
          <h1 className="mb-2 font-bold text-danger">Dropkick couldn’t draw this view</h1>
          <p className="text-sm text-danger">
            Reload Dropkick to recover. Your saved task lists were not changed.
          </p>
          <button
            type="button"
            className="mt-4 rounded-md bg-danger px-3 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
            onClick={this.props.onReload ?? (() => window.location.reload())}
          >
            Reload
          </button>
        </section>
      </main>
    );
  }
}
