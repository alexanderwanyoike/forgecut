# ForgeCut integration check

This local evaluation harness exercises the dependencies proposed for ForgeCut's MCP, graphics preview and code tab. It has its own exact dependency pins and Yarn lockfile so evaluation does not add packages or features to the editor itself.

## Prerequisites

Use Node 22 and Yarn 1.22, FFmpeg, ffprobe and Xvfb. The complete packaged isolation suite also requires Linux x64, Bubblewrap and enabled unprivileged user namespaces. The default font is the locally installed DejaVu Sans file. Set `FORGECUT_CHECK_FONT` and `FORGECUT_CHECK_FONT_LICENSE` together to evaluate another installed TTF and preserve its notices. Generated font/media copies and packaged artifacts stay in ignored directories.

The workspace-only `verify:render` probe defaults to `/usr/bin/google-chrome`. Set `FORGECUT_CHECK_BROWSER` for another compatible executable. The packaged suite instead uses Chromium downloaded during `prepare:runtime` and shipped alongside the worker. It does not download a browser during a render.

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

From this directory, prepare and run the complete Linux x64 evaluation:

```sh
yarn prepare:runtime
yarn package
yarn verify:phase0
```

Run resource-intensive preparation and verification under the resource scope below. `prepare:runtime` packages the compiler, Remotion Node worker, fixed graphics bundle, fonts/images, Chromium and compositor libraries in `results/runtime`. The package copies that directory beside the ASAR, where executable binaries can run. The package includes generated dependency metadata and upstream notices; these evaluation artifacts are excluded from Git.

`verify:phase0` launches the package from a temporary working directory. Check `results/electron.json` for `appPackaged: true` and `developmentServer: false`, and `results/phase0.json` for the isolation and recovery results. It verifies:

- The existing preview, Monaco compiler/worker, frame seeking and local asset checks from the packaged ASAR.
- Packaged Electron's Node runtime compiling TSX and invoking the packaged headless browser and Remotion compositor without the source checkout or a host browser.
- A complete graphics render and timeline composite. The system FFmpeg remains the assembly dependency: Remotion's smaller bundled FFmpeg lacks the overlay filter.
- A separate sandboxed component preview without Node or the editor preload bridge. CSP and session request filtering reject host network/file requests; navigation, new windows, downloads and permission requests are disabled.
- Bubblewrap render namespaces with a clean environment, isolated networking and explicit read-only system/runtime mounts. Only the job directory and private temporary storage are writable. A sentinel file and local service outside the namespace must remain inaccessible.
- Rejection of unsupported imports, termination of runaway preview/export code, editor responsiveness and a successful subsequent render.

The trusted compiler performs syntax transformation rather than executing project modules in Node. Component imports are limited to React and Remotion in this fixture. Transformed source executes in the sandboxed preview or in the browser inside the render namespace. The namespace policy is part of the isolation boundary; a plain child process or `new Function` alone is not a security boundary. These probes validate the stated cases, rather than providing a comprehensive security audit.

## Linux resource measurement

Run heavy checks serially. From this directory, a systemd user scope can enforce a 3 GiB combined process-tree memory limit, a 2 GiB soft threshold and 150% CPU:

```sh
systemd-run --user --scope --quiet \
  -p MemoryMax=3G -p MemoryHigh=2G -p MemorySwapMax=256M -p CPUQuota=150% \
  yarn node measure.mjs complete yarn verify:phase0
```

`measure.mjs` records the cgroup's actual peak, memory limits, CPU quota and child exit status in `results/resources-complete.json`. It requires Linux cgroup v2. Keep the scope around the whole command so the limit covers child browsers and FFmpeg too. For builds and runtime preparation, add `env NODE_OPTIONS=--max-old-space-size=1536` before `yarn node measure.mjs` and use the corresponding label/command.

## Upstream patterns and licences

- MCP follows the [official TypeScript SDK server factory](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md). The pinned SDK packages declare Apache-2.0 and retain their upstream licence notices, including the MIT transition text.
- Graphics follow [Remotion's parameterised component pattern](https://www.remotion.dev/docs/parameterized-rendering), using the same component in Player and the renderer. Remotion uses its own [licence](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md). This fixture is for local evaluation; production distribution terms must be resolved before release.
- Monaco follows its [ES module editor and worker integration](https://github.com/microsoft/monaco-editor). The pinned 0.57 package exports use `monaco-editor/editor/...` and explicit language registration. Preserve its MIT licence and bundled third-party notices when shipping.
- Preview isolation follows [Electron's sandbox and security guidance](https://www.electronjs.org/docs/latest/tutorial/security). Render isolation follows [Bubblewrap's explicit namespace and mount policy](https://github.com/containers/bubblewrap), the established tool used by Flatpak. The harness uses the installed Bubblewrap executable as a system dependency.
- Packaged rendering uses Remotion's [explicit binaries directory](https://www.remotion.dev/docs/options/binaries-directory) and [browser preparation](https://www.remotion.dev/docs/renderer/ensure-browser) APIs. Its [FFmpeg distribution uses GPLv2+](https://www.remotion.dev/docs/miscellaneous/ffmpeg-license); upstream source/build scripts are at [rust-ffmpeg-splitter](https://github.com/remotion-dev/rust-ffmpeg-splitter). Preserve corresponding-source obligations and complete browser/native notices before any public distribution.
- The sample SVG is authored for this fixture. The copied system font retains its installed licence. A portable production project must collect font files and their notices explicitly.

The compiler probe establishes TSX emit and syntax diagnostics. Resolving React/Remotion type declarations, semantic diagnostics, source version promotion and integrating the verified isolation boundaries into the editor remain work for the production code tab. macOS/Windows rendering isolation requires platform-specific implementation and validation before enabling user code there.
