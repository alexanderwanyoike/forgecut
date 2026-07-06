# ForgeCut

A lightweight, Linux-first timeline video editor built with Electron and React. Trim, stitch, add overlays, and export fast.

![ForgeCut screenshot](docs/screenshot.png)

## Features

- **Timeline editing** — Multi-track video and audio timeline with drag, trim, split, and move
- **Real-time preview** — HTML5 video preview with frame-accurate scrubbing
- **Asset bin** — Import video, audio, and image assets; drag directly onto the timeline
- **Thumbnails & waveforms** — Visual clip previews and audio waveform rendering
- **Text & image overlays** — Add titles and image overlays at any position
- **PiP (Picture-in-Picture)** — Multiple video tracks with independent positioning
- **Export** — Hardware-accelerated ffmpeg export with live progress bar
- **Undo / Redo** — Full history for all timeline edits (Ctrl+Z / Ctrl+Shift+Z)
- **Snapping** — Magnetic clip edges for precise alignment
- **Project save / load** — Save and reopen projects in `.forgecut` format
- **Dark & light themes** — Toggle at any time; preference persisted

## Architecture

ForgeCut is an Electron application with a React/Vite renderer and Node main-process backend exposed through a typed preload bridge.

```
forgecut/
├── crates/
│   ├── forgecut_core      # Data model, timeline editing, undo/redo, save/load
│   └── forgecut_render    # Rust render reference implementation during migration
└── apps/
    └── forgecut_gui/
        └── ui/
            ├── electron/  # Electron main/preload and Node backend commands
            └── src/       # React + Vite renderer
```

## Prerequisites

**Runtime dependencies (Linux):**

```bash
# Ubuntu / Debian
sudo apt-get install ffmpeg

# Fedora
sudo dnf install ffmpeg
```

**Build dependencies:**

- [Node.js](https://nodejs.org) ≥ 20 + Yarn (`corepack enable`)
- [Rust](https://rustup.rs) (stable) for the remaining portable crates during migration

## Building

```bash
# Install frontend dependencies
yarn --cwd apps/forgecut_gui/ui install

# Development (hot reload)
yarn --cwd apps/forgecut_gui/ui dev

# Production build
yarn --cwd apps/forgecut_gui/ui build
```

## Running Tests

```bash
# Rust unit tests
cargo test --workspace

# Frontend and Electron backend tests
yarn --cwd apps/forgecut_gui/ui test
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Space` | Play / pause |
| `S` | Split clip at playhead |
| `Delete` / `Backspace` | Delete selected clip |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+=` / `Ctrl+-` | Zoom timeline in / out |
| `Ctrl+0` | Fit timeline to window |
| Drag clip edge | Trim in / out point |
| Drag clip | Move (snaps to other clip edges) |

## CI

GitHub Actions runs on every push and pull request:

| Job | Linux | macOS | Windows |
|---|---|---|---|
| Rust tests | Full workspace | Core + Render | Core + Render |
| Frontend tests | Yes | Yes | Yes |
| Electron build | Yes | Yes | Yes |

## License

MIT — see [Cargo.toml](Cargo.toml)
