# Dropkick

A local-first desktop task manager. Task data is stored in plain JSON files that you control — no cloud, no accounts, no sync. Put your task lists wherever you want, including inside project repositories.

The name references the app's core interaction: kicking tasks down the list when you can't deal with them right now.

Built with Tauri v2, React, and TypeScript.

## Features

- **Local JSON files** — task lists, workspaces, and preferences are portable JSON files at paths you choose
- **Kick mechanism** — push tasks down the list by configurable distances (+5, +25, or to the end) instead of endlessly re-prioritizing
- **Priority groups** — tasks are auto-grouped by priority (Critical, Urgent, Important, Default) and due date (Past Due, Due Within 7 Days)
- **Multiple task lists** — open several task list files as tabs, reorder tabs with drag and drop
- **Unified view** — see all open task lists merged into one view
- **Move tasks between lists** — move tasks to another open list via ⌘M modal, task detail dropdown, or bulk actions
- **Notes with actionability** — attach notes to tasks, mark them as Informational, Actionable, or Resolved; tasks with actionable notes can't be completed until resolved
- **Resizable sidebar** — drag the divider or set a specific width in settings
- **File integrity** — SHA-256 hash checks detect external modifications before overwriting
- **Automatic backup** — GFS-rotated backups per workspace (hourly while running, pruned automatically)
- **IME composition support** — Japanese/Chinese/Korean input works correctly in all text fields
- **Configurable** — font family, zoom level, sidebar width, date/time format, timezone, kick distances

## Data Storage

All data lives on your filesystem:

| File | Location | Purpose |
|---|---|---|
| App config | `~/.dropkick/app.json` | Remembers known workspaces and preferences |
| Preferences | Any path (default: `~/.dropkick/default-preferences.json`) | Display and behavior settings |
| Workspace | Any path (default: `~/.dropkick/default-workspace.json`) | Open tabs, recent files, active tab |
| Task lists | Any path | Your tasks |
| Backups | `~/.dropkick/backups/<workspace-id>/` | Automatic zip backups |

Every change is written to disk immediately. There is no "save" action.

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| New task | ⌘N |
| New note on selected task | ⌘⇧N |
| Move selected tasks | ⌘M |
| Submit dialog | ⌘↩ |
| Save note | ⌘↩ |
| Dismiss selected tasks | ⌫ |
| Move task up | ⌘↑ |
| Move task down | ⌘↓ |
| Send to first in group | ⌘Home |
| Send to last in group | ⌘End |
| Navigate selection | ↑ / ↓ |
| Extend selection | ⇧↑ / ⇧↓ |
| Next tab | ⌘Tab |
| Previous tab | ⌘⇧Tab |
| Close tab | ⌘W |
| Unified view | ⌘U |
| Clear selection | Esc |
| Zoom in / out | ⌘+ / ⌘− |
| Reset zoom | ⌘0 |
| Rename tab | Double-click tab |

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
