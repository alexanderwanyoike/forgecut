# ForgeCut integration check

This local evaluation harness exercises the dependencies proposed for ForgeCut's MCP, graphics preview and code tab. It has its own exact dependency pins and Yarn lockfile so evaluation does not add packages or features to the editor itself.

## Prerequisites

Use Node 22 and Yarn 1.22, FFmpeg, ffprobe, a Chromium installation and, for headless Linux checks, Xvfb. The default font is the locally installed DejaVu Sans file. Set `FORGECUT_CHECK_FONT` to use another installed TTF. Generated font/media copies and packaged artifacts stay in ignored directories.

The renderer defaults to `/usr/bin/google-chrome`. Set `FORGECUT_CHECK_BROWSER` for another compatible Chromium executable. This fixture uses an existing browser rather than downloading one at runtime.

## Run the checks

From the repository root:

```sh
yarn --cwd tools/integration-check install --frozen-lockfile
yarn --cwd tools/integration-check build
yarn --cwd tools/integration-check verify:mcp
xvfb-run --auto-servernum yarn --cwd tools/integration-check verify:electron
yarn --cwd tools/integration-check verify:render
```

Build prepares a local font, an authored SVG image and synthetic H.264/AAC media. The Electron check serves built assets over a secure standard custom protocol, validates a property update and frame seek, exercises Monaco's TypeScript worker and TSX emit, and attempts MKV/MP4 playback. It writes a report and screenshot under `results/`.

The render check uses the same graphic component and local assets. It exports a transparent PNG and ProRes 4444 video, composites the graphic over generated MKV footage using FFmpeg, and checks alpha, visible pixels, dimensions, duration and frame count. Encoding is CPU-based with a single Remotion render slot and explicit FFmpeg thread limits.

The MCP check uses the official SDK's STDIO server factory and client transport for discovery and a read-only fixture tool call. It does not attach to ForgeCut's project state; that belongs to Phase 2.

## Packaged Electron check

Install the main app's development dependencies to obtain its existing electron-builder, then run from this directory:

```sh
yarn exec ../../apps/forgecut_gui/ui/node_modules/.bin/electron-builder -- --dir --linux --config electron-builder.yml
FORGECUT_CHECK_RESULTS="$PWD/results" xvfb-run --auto-servernum ./results/package/linux-unpacked/forgecut-integration-check
```

Check `results/electron.json` for `appPackaged: true` and `developmentServer: false`. This exercises the preview, worker chunks, local assets and source compilation from the packaged ASAR. The separate Node rendering process still runs from the evaluation workspace; packaging that worker remains a Phase 0 acceptance item.

## Linux resource measurement

Run heavy checks serially. From this directory, a systemd user scope can enforce a 3 GiB combined process-tree memory limit, a 2 GiB soft threshold and 150% CPU:

```sh
systemd-run --user --scope --quiet \
  -p MemoryMax=3G -p MemoryHigh=2G -p MemorySwapMax=256M -p CPUQuota=150% \
  env NODE_OPTIONS=--max-old-space-size=1536 \
  yarn node measure.mjs render yarn verify:render
```

`measure.mjs` records the cgroup's actual peak, memory limits, CPU quota and child exit status in `results/resources-render.json`. It requires Linux cgroup v2. Keep the scope around the whole command so the limit covers child browsers and FFmpeg too.

## Upstream patterns and licences

- MCP follows the [official TypeScript SDK server factory](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md). The pinned SDK packages declare Apache-2.0 and retain their upstream licence notices, including the MIT transition text.
- Graphics follow [Remotion's parameterised component pattern](https://www.remotion.dev/docs/parameterized-rendering), using the same component in Player and the renderer. Remotion uses its own [licence](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md). This fixture is for local evaluation; production distribution terms must be resolved before release.
- Monaco follows its [ES module editor and worker integration](https://github.com/microsoft/monaco-editor). The pinned 0.57 package exports use `monaco-editor/editor/...` and explicit language registration. Preserve its MIT licence and bundled third-party notices when shipping.
- The sample SVG is authored for this fixture. The copied system font retains its installed licence. A portable production project must collect font files and their notices explicitly.

The compiler probe establishes TSX emit and syntax diagnostics. Resolving React/Remotion type declarations, semantic diagnostics, source version promotion and isolated execution of user code remain work for the production code tab.
