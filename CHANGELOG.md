# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- An open task list re-reads its file when you return to it, instead of watching the file for changes.
- A save that fails keeps your edit on screen with a **Not saved** notice and **Retry**, instead of reverting the list; quitting or closing the list's tab asks first.
- Unsaved note text lasts while Dropkick runs and no longer comes back after a restart; quitting asks before discarding it.
- A move between lists that fails and cannot be undone marks the destination **Not saved** instead of asking you to reload both files.
- The backup history keeps one copy per file per session and no longer slows a save down.

### Fixed

- Files saved by 0.1.0 open again: task lists, workspaces, preferences and saved locations.

## [0.1.0] - 2026-07-08

### Added

- First public release.
