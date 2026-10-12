# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Use one app-wide settings collection across all workspaces. Existing last-used preferences are adopted once, preserving the original files. First launch and the main menu's **Switch workspace…** show one workspace list, where you create, add, rename, remove and open workspaces; removing one leaves its file in place. Later launches reopen the last workspace.

- An open task list re-reads its file when you return to it, instead of watching the file for changes.
- A save that fails keeps your edit on screen with a **Not saved** notice and **Retry**, instead of reverting the list; quitting or closing the list's tab asks first.
- Unsaved note text lasts while Dropkick runs and no longer comes back after a restart; quitting asks before discarding it.
- A move between lists that fails and cannot be undone marks the destination **Not saved** instead of asking you to reload both files.
- The backup history keeps one copy per file per session and no longer slows a save down.

### Fixed

- Hovering a menu command preserves the keyboard target, and opening initializes arrow navigation. Selected tabs and rows respond to hover without hiding keyboard focus.
- Drafts belong to the exact task-list copy being edited; saving, deleting or moving another copy preserves its text. Save receipts follow successful moves without clearing newer typing.
- Switching workspaces retires departed lists and unfinished reads, preserves unsaved work, and opens without waiting for unrelated background state saves.
- Bulk changes save each affected list once. Records keeps contiguous new entries during paging, and date grouping updates after midnight or resume.
- Pending Settings and New Task submissions prevent duplicate saves and further edits until completion.
- Startup ownership is bounded, Records opening leaves asynchronous workers free, and saves follow long file-symlink chains without replacing the links.
- Retry can save retained edits after cancelled file recreation or a failed conflict reload.
- Closing an inactive tab saves parked title and description edits; quit still names note drafts from closed lists.
- Quitting checks failed workspace saves, and OS shutdown no longer treats a withdrawn conflict question as permission to discard local changes.

- Files saved by 0.1.0 open again: task lists, workspaces, preferences and saved locations.

## [0.1.0] - 2026-07-08

### Added

- First public release.
