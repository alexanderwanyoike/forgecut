# 0017: Explicit application updates

Status: Accepted

## Context

Users need to discover and install releases from the editor's bottom footer.
ForgeCut uses electron-builder 26 and publishes unsigned desktop installers.
Updates must preserve the project and remain separate from ordinary quit.

## Decision

Use electron-updater 6.8.11 with the fixed public GitHub feed
`alexanderwanyoike/forgecut`. Installed x64 AppImages support checks, downloads with progress, and explicit
restart to install. Development builds, Windows, unsigned macOS, and Linux
package installations offer the
latest release's manual installers. Development builds never contact the feed.

Disable unattended downloads, installation on quit, downgrades, prereleases and
differential downloads. Check once after startup and allow subsequent manual
checks. Expected failures use the shared Result type and leave retry available.
The renderer cannot choose a feed, executable or download URL.

Before requesting installation, the editor resolves the source editor's close
guard and asks the user to save the project. A native confirmation defaults to
Keep working and explains that active media work will be cancelled. A project
revision or session change during that confirmation cancels installation.

Use the upstream client to download and verify SHA-512 checksums. On Linux, copy
the verified file beside the installed AppImage, preserve permissions, then rename
it over the original path before relaunching. This keeps shortcuts valid and
leaves the old executable intact if copying fails. Windows uses the manual installer until its asynchronous native launch and
relaunch lifecycle can be verified on Windows.

Packaging generates and uploads update YAML and companion blockmaps alongside
installers. Release PRs build installers as workflow artifacts without creating a
GitHub Release. Tag builds assemble all platforms before creating a draft release.
A draft must be published before installed clients can discover it. The first
updater-enabled release must be installed manually by existing users.

## Established patterns

This follows the explicit update flow and stable AppImage path used by Muzo
(`docs/adr/0009-explicit-desktop-updates.md`), plus the installed-build boundary
and footer controls in Auto Digger and Showbiz. These projects are MIT licensed,
Copyright 2026 Alexander Wanyoike. Their patterns informed this implementation;
no source was copied.

- [electron-builder 26 update documentation](https://www.electron.build/v26/docs/features/auto-update/)
- Installed `electron-updater/out/AppImageUpdater.js` and `BaseUpdater.js`.
