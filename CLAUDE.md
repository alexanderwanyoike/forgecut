# ForgeCut

Lightweight Linux-first timeline video editor. Trim, stitch, overlays, and quick exports.

## Architecture

- **forgecut_core** -- Pure Rust data model, timeline editing, undo/redo, project save/load
- **forgecut_render** -- ffmpeg integration: ffprobe, render pipeline, export
- **forgecut_preview** -- mpv integration: IPC control, preview playback
- **apps/forgecut_gui/** -- Tauri 2 + SolidJS + Vite frontend

## Build

- Use `yarn` (never npm/pnpm)
- Rust workspace with `cargo check --workspace` / `cargo test --workspace`
- Frontend: `yarn --cwd apps/forgecut_gui/ui install && yarn --cwd apps/forgecut_gui/ui build`
- Tauri dev: `cargo tauri dev` from `apps/forgecut_gui/src-tauri`

## Conventions

- Time is stored as `TimeUs(i64)` microseconds throughout
- All core types derive `Debug, Clone, Serialize, Deserialize, PartialEq`
- Error types use `thiserror`, propagation via `anyhow` at boundaries
- IDs are `uuid::Uuid`
- ffmpeg/ffprobe spawned as child processes, never linked
