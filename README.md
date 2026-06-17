# Dropkick

Dropkick is a local-first desktop task manager built around one idea: when you can't deal with a task right now, *kick* it down the list instead of endlessly re-prioritizing. Task lists, workspaces, and preferences are plain JSON files at paths you choose — no cloud, no accounts, no sync — so your tasks can live anywhere, including inside project repositories. It's a cross-platform desktop app (macOS and Windows) built with Tauri v2, React, and TypeScript, with a keyboard-first workflow and automatic priority grouping.

## Features

- **Kick mechanism** — push a task down the list by a configurable distance (+5, +25, or to the end) instead of re-ranking everything
- **Automatic priority groups** — tasks sort into Past Due → Critical → Due Today → Important → Urgent → Due Soon, with date-based lifting; Important ranks above Urgent by design
- **Multiple task lists** — open several files as tabs, see them merged in a unified view, and move tasks between lists
- **Notes with actionability** — mark notes Informational, Actionable, or Resolved; a task with an unresolved actionable note can't be completed
- **Keyboard-first** — change status, priority, and due dates without leaving the keys
- **Safe on disk** — SHA-256 change detection before overwrite, plus automatic GFS-rotated backups per workspace
- **IME-safe** — Japanese/Chinese/Korean input works in every text field

## Requirements

- macOS or Windows
- To build and run from source: a Rust toolchain, Node.js, and the Tauri v2 system dependencies

## Getting started

Double-click the launcher for your platform (`scripts/run-dev.command` on macOS, `scripts/run-dev.ps1` on Windows), or run from source:

```sh
npm install
npm run tauri dev
```

## License

MIT © 2026 Yoshinao Inoguchi

## Contact

Yoshinao Inoguchi — nao7sep@gmail.com
