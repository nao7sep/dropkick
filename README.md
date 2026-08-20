# Dropkick

Dropkick is a local-first desktop task manager built around one idea: when you can't deal with a task right now, *kick* it down the list instead of endlessly re-prioritizing. Task lists, workspaces, and preferences are plain JSON files at paths you choose — no cloud, no accounts, no sync — so your tasks can live anywhere, including inside project repositories. It's a cross-platform desktop app (macOS and Windows) built with Tauri v2, React, and TypeScript, with a keyboard-first workflow and automatic priority grouping.

## Features

- **Kick mechanism** — push a task down the list by a configurable distance (+5, +25, or to the end) instead of re-ranking everything
- **Automatic priority groups** — tasks sort into Past Due → Critical → Due Today → Important → Urgent → Due Soon, with date-based lifting; Important ranks above Urgent by design
- **Multiple task lists** — open several files as tabs, see them merged in a unified view, and move tasks between lists
- **Notes with actionability** — mark notes Informational, Actionable, or Resolved; a task with an unresolved actionable note can't be completed
- **Keyboard-first** — change status, priority, and due dates without leaving the keys
- **Safe on disk** — SHA-256 change detection before overwrite, so an edit made to a task file outside the app is never silently clobbered
- **IME-safe** — Japanese/Chinese/Korean input works in every text field

## Requirements

- macOS or Windows
- To build and run from source: a Rust toolchain, Node.js, and the Tauri v2 system dependencies

## Download

Prebuilt installers and portable builds for macOS (Apple Silicon) and Windows are on the [Releases](https://github.com/nao7sep/dropkick/releases/latest) page. These builds are **unsigned**, so the OS warns the first time you open one:

- **macOS** — right-click the app and choose **Open** (or run `xattr -dr com.apple.quarantine /Applications/Dropkick.app`).
- **Windows** — on the SmartScreen prompt, click **More info → Run anyway**.

## First run

Dropkick keeps your settings and your open tabs in two JSON files you choose, so the first launch asks for both before it opens anything:

1. Under **Preferences**, click **New** and save a preferences file — `~/.dropkick/preferences.json` is a fine default.
2. Under **Workspace**, do the same for a workspace file.
3. Click **Launch**.

From then on both are remembered and Launch is one click. Task lists themselves are separate files, created from **New task list...** in the tab bar's ☰ menu, and can live anywhere — including inside a project repository.

## Run from source

Launch it with the script for your platform — double-click `scripts/run-dev.command` on macOS, or right-click `scripts/run-dev.ps1` and choose *Run with PowerShell* on Windows. Or run it by hand:

```sh
npm install
npm run tauri dev
```

## License

MIT © 2026 Yoshinao Inoguchi

## Contact

Yoshinao Inoguchi — yoshinao@inoguchi.com — <https://inoguchi.com>
