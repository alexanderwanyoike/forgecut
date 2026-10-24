# ForgeCut

Lightweight Linux-first timeline video editor. Trim, stitch, overlays, and quick exports.

## Architecture

- **apps/forgecut_gui/ui/electron/** -- Electron main/preload and Node backend commands
- **apps/forgecut_gui/ui/src/** -- React + Vite renderer

## Build

- Use `yarn` (never npm/pnpm)
- App: `yarn --cwd apps/forgecut_gui/ui install && yarn --cwd apps/forgecut_gui/ui build`
- Tests: `yarn --cwd apps/forgecut_gui/ui test`
- Electron dev: `yarn --cwd apps/forgecut_gui/ui dev`

## Conventions

- Time is stored as `TimeUs` (number) microseconds throughout
- Serialized data uses snake_case fields and tagged item variants (VideoClip, AudioClip, ImageOverlay, TextOverlay) for `.forgecut` project compatibility
- ffmpeg/ffprobe spawned as child processes, never linked
- IDs are UUIDs
- Backend commands live in `electron/backend/commands/` and are dispatched by name via IPC; keep domain logic pure in `electron/backend/` modules

## Delivery

- Work on a focused `codex/` feature branch instead of committing directly to `dev` or `main`.
- Deliver completed implementation work as a pull request and link it in the final response. Local commits alone are not a completed handoff.
- Keep implementation phases in separate PRs. If a phase depends on an unmerged phase, state that dependency and the merge order in both PR descriptions.
- PR descriptions use `## Background`, `## Tasks` with a checklist, and `## Tested`, in that order. Add `## Tech Debt` only when needed.
