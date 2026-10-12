# Dropkick

Let tasks sort themselves by urgency, kick the ones you can't do yet down the list, and keep every list in plain JSON files. Task lists and workspaces are plain JSON files at paths you choose — no cloud, no accounts, no sync — so your tasks can live anywhere, including inside project repositories. It's a cross-platform desktop app (macOS and Windows) built with Tauri v2, React, and TypeScript, with a keyboard-first workflow and automatic priority grouping.

## Features

- **Kick mechanism** — push a task down the list by a configurable distance (+5, +25, or to the end) instead of re-ranking everything
- **Automatic priority groups** — tasks sort into Past Due → Critical → Due Today → Important → Urgent → Due Soon, with date-based lifting; Important ranks above Urgent by design
- **Multiple task lists** — open several files as tabs, see them merged in a unified view, and move tasks between lists
- **Notes with actionability** — mark notes Informational, Actionable, or Resolved; a task with an unresolved actionable note can't be completed
- **Unsaved text stays while you work** — text typed into a new note or an existing note's editor stays when you switch tasks or tabs, until you save it, **Cancel** it, or press **Escape** on a changed edit, which asks first. Quitting with unsaved note text asks before discarding it, and it does not come back after a restart. A task's title or description is saved when you leave the field, and at quit.
- **Keyboard-first** — change status, priority, and due dates without leaving the keys
- **Safe on disk** — an open list re-reads its file when you return to it (its tab, the unified view, or the window coming to the front), so changes made by an editor, git or a synced folder show up; while you have unsaved changes for it, it keeps your copy, and a check before every save means an outside change is never silently overwritten — you choose to overwrite it or reload. A save that fails keeps your edit, marks the list **Not saved** and offers **Retry**
- **IME-safe** — Japanese/Chinese/Korean input works in every text field
- **Ten interface languages** — English, Japanese, Chinese, Korean, Spanish, Portuguese, French, German, Italian, and Russian, following the computer's language by default

## Requirements

- macOS or Windows
- To build and run from source: a Rust toolchain, Node.js, and the Tauri v2 system dependencies

## Download

Prebuilt installers and portable builds for macOS (Apple Silicon) and Windows are on the [Releases](https://github.com/nao7sep/dropkick/releases/latest) page. These builds are **unsigned**, so the OS warns the first time you open one:

- **macOS** — right-click the app and choose **Open** (or run `xattr -dr com.apple.quarantine /Applications/Dropkick.app`).
- **Windows** — on the SmartScreen prompt, click **More info → Run anyway**.

## First run

All workspaces use the same app settings. A workspace is a file that remembers which task lists are open, wherever those lists are stored. On first launch, Dropkick shows the workspace list: choose **New…** to save a new workspace file anywhere, or **Add existing…** to list one you already have, then **Open workspace**. Add task lists from the **+** menu with **New task list…** or **Open existing file…**.

Later launches reopen your last workspace directly. Choose **Switch workspace…** from the main menu to return to the list, where **Rename…** changes a workspace's name and **Remove** takes it off the list without touching its file. A missing or unreadable workspace returns you to the list without replacing it.

Settings are saved privately in `~/.dropkick/settings.json` (or the configured `DROPKICK_DATA_DIR`). Only choices that differ from the built-ins are stored. On upgrade, Dropkick copies the last-used preferences into this app-wide collection once; the original preferences files remain unchanged. If those selected preferences cannot be read, startup names the file to restore or make accessible before trying again. Settings files are no longer selected separately for each workspace.

Task lists themselves are separate files, created from **New task list...** in the tab bar's ☰ menu, and can live anywhere — including inside a project repository.

## Run from source

Launch it with the script for your platform — double-click `scripts/run-dev.command` on macOS, or right-click `scripts/run-dev.ps1` and choose *Run with PowerShell* on Windows. Or run it by hand:

```sh
npm install
npm run tauri dev
```

## License

[GNU GPL v3 or later](LICENSE) © 2026 Yoshinao Inoguchi

## Contact

Yoshinao Inoguchi — yoshinao@inoguchi.com — <https://inoguchi.com>
