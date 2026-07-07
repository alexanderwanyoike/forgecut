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
