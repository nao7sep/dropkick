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
- **Resizable sidebar** — drag the divider between the task list and detail pane
- **File integrity** — SHA-256 hash checks detect external modifications before overwriting; if a file changed outside Dropkick, you can overwrite or reload, and if it was deleted, you can recreate it or cancel the change
- **Automatic backup** — GFS-rotated backups per workspace (hourly while running, pruned automatically)
- **IME composition support** — Japanese/Chinese/Korean input works correctly in all text fields
- **Configurable** — font family, date/time format, timezone, kick distances, due soon window in Settings; zoom (50%–500%) via the gear menu or keyboard shortcuts

## Data Storage

All data lives on your filesystem:

| File | Location | Purpose |
|---|---|---|
| App config | `~/.dropkick/app.json` | Remembers known workspaces and preferences |
| Preferences | Any path (default: `~/.dropkick/default-preferences.json`) | Display and behavior settings |
| Workspace | Any path (default: `~/.dropkick/default-workspace.json`) | Open tabs and recent files |
| Task lists | Any path | Your tasks |
| Backups | `~/.dropkick/backups/<workspace-id>/` | Automatic zip backups |

Task changes are written to disk immediately. Settings dialog changes require an explicit **Save**; zoom level and sidebar width are saved immediately when changed from the gear menu, keyboard shortcuts, or divider drag.
At startup, Dropkick reopens unified view if it is among the open tabs; otherwise it opens the first task list tab. The current active tab is runtime-only and is not written to `workspace.json`.

If a saved task-list tab or recent file cannot be loaded because the file is missing or temporarily unavailable, Dropkick keeps the workspace reference instead of removing it automatically. The affected tab shows a load-error pane with **Retry** and **Remove tab** actions so you can reconnect the file or remove the tab manually.

## Keyboard Shortcuts

Shortcuts are shown with `Cmd`. On Windows, use `Ctrl` instead. Shortcuts can change meaning by context; modal shortcuts apply only inside that modal.

### Selection Flow

Dropkick treats review actions and focused edits as two different flows:

- **List review flow** — when you use task-list shortcuts for status, priority, or due date, Dropkick assumes you are reviewing the list from top to bottom. After a successful change, selection advances to the next active task in visual order, crossing group boundaries when needed. If there is no next active task, selection clears instead of following the task into Handled.
- **Focused edit flow** — when you change priority, due date, or order from the task detail pane, Dropkick keeps the same task selected so you can continue editing its title, description, and notes.

Task-list reorder shortcuts also keep the same task selection, so repeated `Cmd+Up` / `Cmd+Down` presses continue moving the tasks you just moved.

Detail-pane status changes, task deletion, and moves out of the current non-unified list leave the current task behind, so they use the list review flow and select the next active task. In unified view, moving a task to another list keeps it selected because the task remains visible.

### Task List

| Action | Shortcut |
|---|---|
| New task | Cmd+N |
| Move selected tasks | Cmd+M |
| Focus new note field | Cmd+Shift+N |
| Save note | Cmd+Enter |
| Save note as actionable | Cmd+Shift+Enter |
| Set status to Pending | P |
| Set status to Completed | C |
| Set status to Dismissed | X |
| Dismiss selected tasks | Backspace / Delete |
| Set priority to Default | 0 |
| Set priority to Urgent | 1 |
| Set priority to Important | 2 |
| Set priority to Critical | 3 |
| Set due date to today | T |
| Set due date to tomorrow | Y |
| Clear due date | N |
| Navigate selection | Up / Down |
| Extend selection | Shift+Up / Shift+Down |
| Clear selection | Esc |
| Move task up | Cmd+Up |
| Move task down | Cmd+Down |
| Send to first in group | Cmd+Home |
| Send to last in group | Cmd+End |

### Dialogs

| Action | Shortcut |
|---|---|
| Create task in New Task modal | Cmd+Enter |
| Set draft priority to Default | Cmd+0 |
| Set draft priority to Urgent | Cmd+1 |
| Set draft priority to Important | Cmd+2 |
| Set draft priority to Critical | Cmd+3 |
| Set draft due date to today | Cmd+T |
| Set draft due date to tomorrow | Cmd+Y |
| Clear draft due date | Cmd+N |
| Submit settings / move dialog | Cmd+Enter |
| Close active dialog | Esc |

### Tabs And App

| Action | Shortcut |
|---|---|
| Next tab (Windows/Linux) | Ctrl+Tab |
| Previous tab (Windows/Linux) | Ctrl+Shift+Tab |
| Close tab | Cmd+W |
| Unified view | Cmd+U |
| Rename tab | Double-click tab |
| Zoom in | Cmd+Equal / Cmd+Plus / Cmd+Semicolon |
| Zoom out | Cmd+Minus |
| Reset zoom | Cmd+0 |

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

### Testing

```sh
npm test                                  # frontend unit tests (Vitest)
cargo test --lib --manifest-path src-tauri/Cargo.toml   # Rust command tests
```

Tests cover the pure logic (task grouping, the kick/reorder algorithms, date and
timezone handling, backup rotation), the Zustand stores and file repositories
(with Tauri mocked), and the Rust commands.

### Production Build

```sh
npm run tauri build
```

The built application will be in `src-tauri/target/release/`.

## License

MIT — Yoshinao Inoguchi ([@nao7sep](https://github.com/nao7sep))
