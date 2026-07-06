# ForgeCut

Lightweight Linux-first timeline video editor. Trim, stitch, overlays, and quick exports.

## Architecture

- **forgecut_core** -- Pure Rust data model, timeline editing, undo/redo, project save/load
- **forgecut_render** -- Rust render reference implementation during migration
- **apps/forgecut_gui/ui/electron/** -- Electron main/preload and Node backend commands
- **apps/forgecut_gui/ui/src/** -- React + Vite renderer

## Build

- Use `yarn` (never npm/pnpm)
- Rust workspace with `cargo check --workspace` / `cargo test --workspace`
- App: `yarn --cwd apps/forgecut_gui/ui install && yarn --cwd apps/forgecut_gui/ui build`
- Electron dev: `yarn --cwd apps/forgecut_gui/ui dev`

## Conventions

- Time is stored as `TimeUs(i64)` microseconds throughout
- All core types derive `Debug, Clone, Serialize, Deserialize, PartialEq`
- Error types use `thiserror`, propagation via `anyhow` at boundaries
- IDs are `uuid::Uuid`
- ffmpeg/ffprobe spawned as child processes, never linked
