# Dropkick's areas, and the tests that stand for them

`npm test` is the type check plus this whole Vitest suite, plus `cargo test` over the Rust crate: at
a few seconds it is already a fixed, balanced run, so nothing selects a subset of it. This file is
the balance judgement the `tests-folder-conventions` require — which areas Dropkick has, and which
tests stand for each — so a reader can tell what a green run covered, and an area with no test
standing for it is visible rather than merely absent. `tests/area-map.test.ts` holds every path below
to what is on disk.

Paths are relative to the repository root, because Dropkick's tests live in two trees: `tests/` for
the window and `src-tauri/tests/` for the native side.

| Area | What it covers | Tests standing for it |
|---|---|---|
| Tasks and notes | Creating, editing, completing and deleting a task and its notes, and the rules that gate a status change | `tests/services/task-operations.test.ts`, `tests/services/validation.test.ts`, `tests/services/task-deletion.test.ts`, `tests/utils/factories.test.ts` |
| Kicking and ordering | The kick itself, the moves around it, and which list a task lands in | `tests/services/kick.test.ts`, `tests/services/move-operations.test.ts`, `tests/utils/bulk-status.test.ts`, `tests/components/layout/task-target-validation.test.ts` |
| Priority groups and dates | The group ladder, due dates, list urgency, and the time zone they are read in | `tests/utils/domain-mapping.test.ts`, `tests/services/grouping.test.ts`, `tests/services/list-urgency.test.ts`, `tests/utils/dates.test.ts`, `tests/utils/timezone.test.ts` |
| Task lists and tabs | Several lists open as tabs, the unified view across them, and reordering and renaming them | `tests/state/workspace-store.test.ts`, `tests/repositories/workspace-repository.test.ts`, `tests/components/layout/tab-bar.test.ts`, `tests/components/layout/tab-dnd.test.ts`, `tests/services/unified-load-state.test.ts`, `tests/services/task-list-empty-state.test.ts` |
| Task list files on disk | Loading and writing a list file, the change detection before an overwrite, and the atomic write under it | `tests/repositories/task-list-repository.test.ts`, `tests/state/task-list-store.test.ts`, `tests/repositories/file-system.test.ts`, `src-tauri/tests/atomic_write.rs`, `src-tauri/tests/nanoid.rs` |
| Note drafts | Text typed into a note composer, written through to draft storage and returned when the task is revisited | `tests/services/note-drafts.test.ts`, `tests/state/note-draft-store.test.ts` |
| Preferences | The preferences document, its defaults and normalization, and the settings dialog over it | `tests/models/preferences.test.ts`, `tests/repositories/preferences-repository.test.ts`, `tests/state/preferences-store.test.ts`, `tests/services/preferences-draft.test.ts`, `tests/components/layout/settings-modal.test.ts`, `tests/utils/merge-defaults.test.ts` |
| Startup and storage paths | The first-run picker, the app-level state behind it, and the storage root the app resolves | `tests/components/layout/startup-picker.test.ts`, `tests/repositories/app-state-repository.test.ts`, `tests/state/app-state-store.test.ts`, `src-tauri/tests/paths.rs` |
| Selection and the keyboard | What is selected, what the keys do to it, and the shortcuts the app claims | `tests/utils/selection.test.ts`, `tests/utils/shortcuts.test.ts`, `tests/hooks/use-keyboard-shortcuts.test.ts`, `tests/components/layout/keyboard-shortcuts-modal.test.ts`, `tests/components/shared/selected-task-title-list.test.ts`, `tests/utils/passive-scroll.test.ts` |
| Dialogs, modals, and text entry | The modal shell, the queued dialogs, the native pickers, and typing that survives an IME | `tests/components/shared/app-modal.test.ts`, `tests/components/shared/app-dialog-host.test.ts`, `tests/state/dialog-store.test.ts`, `tests/repositories/dialogs.test.ts`, `tests/hooks/useComposing.test.ts`, `tests/utils/textCleanup.test.ts`, `tests/components/shared/toolbar.test.ts`, `tests/components/about-modal-links.test.ts` |
| Results, toasts, and failures | What the app says when an operation or a load goes wrong, and where it says it | `tests/services/task-action-results.test.ts`, `tests/services/load-failure.test.ts`, `tests/services/recovery-presentation.test.ts`, `tests/state/toast-store.test.ts`, `tests/components/shared/toast-host.test.ts`, `tests/components/task-detail/task-detail-results.test.ts`, `tests/components/task-detail/bulk-actions-results.test.ts`, `tests/components/task-list/task-list-results.test.ts`, `tests/components/main-window-error-boundary.test.ts` |
| Logging | The log envelope and the redaction that keeps paths and task text out of it | `tests/repositories/logging.test.ts`, `src-tauri/tests/logging.rs` |
| Interface language | The catalogues, the translator, and the guards that no key or English literal reaches the screen | `tests/i18n/catalogues.test.ts`, `tests/i18n/translate.test.ts`, `tests/i18n/languages.test.ts`, `tests/i18n/hardcoded-text.test.ts`, `tests/config/bundle-localizations.test.ts`, `src-tauri/tests/i18n.rs` |
| Window, theme, and styling | The window's size and placement, closing it, zoom, light and dark, and the stylesheet | `tests/app-theme.test.ts`, `tests/utils/window-sizing.test.ts`, `tests/utils/zoom.test.ts`, `tests/hooks/use-window-close.test.ts`, `tests/styles/theme-contrast.test.ts`, `tests/styles/scrollbar.test.ts`, `tests/styles/ui-font.test.ts`, `src-tauri/tests/theme.rs`, `src-tauri/tests/window_placement.rs` |
| The native boundary | What the window is allowed to call, the content policy, how commands are dispatched, and what the OS may drop on it | `tests/config/tauri-capabilities.test.ts`, `tests/config/tauri-csp.test.ts`, `tests/config/tauri-command-dispatch.test.ts`, `tests/config/tauri-drag-drop.test.ts`, `tests/utils/external-drop-boundary.test.ts` |
| Packaging and the release surface | What ships, how it is built, the launchers, and the version it claims | `tests/installer-config.test.ts`, `tests/version.test.ts`, `tests/helpers/versions.test.ts`, `tests/config/third-party-notices.test.ts`, `tests/config/launcher-runtime.test.ts`, `tests/config/cargo-development-profile.test.ts`, `tests/config/development-endpoints.test.ts` |

Dropkick has nothing paid, external, or heavy in the product, so there is no `test:full`: `npm test`
is the full gate.
