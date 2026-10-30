# Linux application-menu integration

Packaged Linux AppImages register a user launcher on startup. Distribution packages continue to use electron-builder's existing system launcher. Development and unpacked launches do not register shortcuts.

The launcher uses the outer `APPIMAGE` path and a copied icon, so neither depends on the temporary mount. It follows `XDG_DATA_HOME`, falling back to `~/.local/share` when unset, empty or relative. The desktop ID is `forgecut.desktop`, matching the package launcher. Window identity is `forgecut` for normal desktop pinning.

Managed entries refresh after relocation. Custom entries at that ID are preserved. Writes use a temporary file and atomic publication; storage failures return a typed Result and log a warning while the editor opens normally.

## Established patterns

This follows Auto Digger's `src/main/desktop/appImage.ts` and Muzo's `apps/desktop/electron/install-appimage-menu.ts`, using the standard XDG/AppImage integration approach. No external implementation is copied and no runtime dependency is added.

- [Desktop Entry Exec escaping](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html)
- [XDG data directories](https://specifications.freedesktop.org/basedir/latest/)
- [AppImage desktop integration](https://docs.appimage.org/reference/desktop-integration.html)

## Verification

The Linux tests use real GIO discovery and execution, including spaces and desktop metacharacters. They cover registration, relocation, custom launchers, XDG defaults, invalid paths and storage failures. Other platforms verify that integration is skipped.

The package workflow launches its actual AppImage under Xvfb with disposable user data, then checks desktop-file validation, GIO discovery, durable icon, outer executable and window identity. The harness supplies `--no-sandbox` for its isolated CI launch. These checks verify the Linux integration boundary; they do not run the full Mint or Arch desktop environments.
