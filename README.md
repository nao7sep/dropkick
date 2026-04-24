# Dropkick

A local-first desktop task manager. Task data is stored in plain JSON files that you control — no cloud, no accounts, no sync. Put your task lists wherever you want, including inside project repositories.

The name references the app's core interaction: kicking tasks down the list when you can't deal with them right now.

Built with Tauri v2, React, and TypeScript.

## Features

- **Local JSON files** — task lists, workspaces, and preferences are portable JSON files at paths you choose
- **Kick mechanism** — push tasks down the list by configurable distances (+5, +25, or to the end) instead of endlessly re-prioritizing
- **Priority groups** — tasks are auto-grouped and displayed in this order: Past Due → Critical → Due Today → Important → Urgent → Due Soon → Tasks. Due Today and Due Soon are date-based: they elevate tasks regardless of their priority setting. Important ranks above Urgent by design — urgent-but-unimportant work is a common productivity trap.
- **Multiple task lists** — open several task list files as tabs, reorder tabs with drag and drop
- **Unified view** — see all open task lists merged into one view
- **Move tasks between lists** — move tasks to another open list via `Cmd+M`, the task detail dropdown, or bulk actions
- **Notes with actionability** — attach notes to tasks, mark them as Informational, Actionable, or Resolved; tasks with actionable notes can't be completed until resolved
- **Keyboard-first workflow** — selection shortcuts can change status, priority, and due dates; dialogs close with `Esc`
- **Resizable sidebar** — drag the divider or set a specific width in settings
- **File integrity** — SHA-256 hash checks detect external modifications before overwriting
- **Automatic backup** — GFS-rotated backups per workspace (hourly while running, pruned automatically)
- **IME composition support** — Japanese/Chinese/Korean input works correctly in all text fields
- **Configurable** — font family, zoom level, sidebar width, date/time format, timezone, kick distances, due soon window (days from tomorrow, default 7)

## Data Storage

All data lives on your filesystem:

| File | Location | Purpose |
|---|---|---|
| App config | `~/.dropkick/app.json` | Remembers known workspaces and preferences |
| Preferences | Any path (default: `~/.dropkick/default-preferences.json`) | Display and behavior settings |
| Workspace | Any path (default: `~/.dropkick/default-workspace.json`) | Open tabs and recent files |
| Task lists | Any path | Your tasks |
| Backups | `~/.dropkick/backups/<workspace-id>/` | Automatic zip backups |

Task changes are written to disk immediately. Preferences require an explicit **Save** in the Settings dialog.
At startup, Dropkick reopens unified view if it is among the open tabs; otherwise it opens the first task list tab. The current active tab is runtime-only and is not written to `workspace.json`.

## Keyboard Shortcuts

Shortcuts are shown with `Cmd`. On Windows, use `Ctrl` instead. Letter and number shortcuts apply to the current task selection.

| Action | Shortcut |
|---|---|
| New task | Cmd+N |
| Focus new note field | Cmd+Shift+N |
| Move selected tasks | Cmd+M |
| Submit new task / settings | Cmd+Enter |
| Save note | Cmd+Enter |
| Set status to Pending | P |
| Set status to Completed | C |
| Set status to Dismissed | X |
| Set priority to Default | 0 |
| Set priority to Urgent | 1 |
| Set priority to Important | 2 |
| Set priority to Critical | 3 |
| Set due date to today | T |
| Set due date to tomorrow | Y |
| Clear due date | N |
| Dismiss selected tasks | Backspace / Delete |
| Move task up | Cmd+Up |
| Move task down | Cmd+Down |
| Send to first in group | Cmd+Home |
| Send to last in group | Cmd+End |
| Navigate selection | Up / Down |
| Extend selection | Shift+Up / Shift+Down |
| Next tab (Windows/Linux) | Ctrl+Tab |
| Previous tab (Windows/Linux) | Ctrl+Shift+Tab |
| Close tab | Cmd+W |
| Unified view | Cmd+U |
| Close active dialog / clear selection | Esc |
| Zoom in / out | Cmd+Plus / Cmd+Minus |
| Reset zoom | Cmd+0 |
| Rename tab | Double-click tab |

On macOS, `Cmd+Tab` and `Cmd+Shift+Tab` are reserved by the system for app switching.

## Building from Source

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) (v18+)
- Tauri v2 system dependencies — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development

```sh
npm install
npm run tauri dev
```

### Production Build

```sh
npm run tauri build
```

The built application will be in `src-tauri/target/release/`.

## License

MIT — Yoshinao Inoguchi ([@nao7sep](https://github.com/nao7sep))
