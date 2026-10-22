# Local editing integration foundations

Date: 22 October 2026.

Status: accepted; Phase 0 technical feasibility checks complete on Linux x64. Public release requirements are recorded below.

## Context

ForgeCut needs one project that can be edited through its UI and through Codex MCP tools. Titles and other graphics need both visual property editing and access to their Remotion source. The existing application uses Electron 33, React 18, Vite and FFmpeg child processes.

An isolated [integration harness](../../tools/integration-check/README.md) evaluates these integrations without adding dependencies to the editor's production package. Exact evaluation versions are Remotion, Player, bundler and renderer 4.0.537; Monaco 0.57.0; MCP client/server 2.3.1; Electron 33.4.11; React/React DOM 18.3.1; and Vite 6.4.1. The Node evaluation runtime was 22.19.0.

## Decisions

Keep Electron main as the sole project owner. Use the official MCP SDK's STDIO transport for the Codex-facing adapter and an authenticated OS-local bridge into the application. The existing typed IPC contract and pure timeline operations inform the shared editing service. The adapter will not own an independent project copy. SDK discovery and a read-only tool call have passed in the harness; the authenticated bridge and project operations are Phase 2 work.

Use Remotion components with declared editable properties and stable layer IDs. Store instance values separately from source. Remotion's parameterised component pattern supplies the input model; its Player and renderer can share a component. Studio's Interactive features inform the design, but are not assumed to be an editing SDK that can be dropped into Player. Canvas interaction remains ForgeCut functionality.

Retain the hybrid rendering baseline: FFmpeg assembles footage and audio, and a separate worker renders Remotion graphics. The fixture exports transparent PNG and ProRes 4444 graphics and successfully composites them over footage. This supports the existing FFmpeg architecture. A second complete sequence renderer adds another timing/audio implementation without evidence of a benefit at this stage.

Use Monaco for the code tab, loaded on demand. The fixture uses the pinned package's ESM exports, explicit TypeScript language registration and a dedicated TypeScript worker. Language activation loads asynchronously; callers must wait for worker readiness before compilation. The probe validates TSX emit and syntax diagnostics. React/Remotion type resolution and source promotion remain Phase 6 work.

Use a secure standard application origin for the future code/graphics surface instead of depending on worker behaviour under `file://`. A custom protocol served the fixture's built assets and worker chunks successfully from an ASAR. Production integration must retain resource path validation, correct MIME types, restricted capabilities and media Range responses. It must not copy the fixture's small-file media handler into the long-recording playback path.

Keep heavy jobs serial initially and enforce a process-tree resource budget. Render concurrency was one; the FFmpeg fixture explicitly limits codec/filter threads. A production policy must also cover children, cancellation and cleanup. The nonminified evaluation build stays separate from the product's build configuration; Monaco needs lazy loading and a deliberate worker/bundle strategy before adoption.

Package the Remotion worker as a Node-compatible bundle and ship executable dependencies beside the ASAR using Electron extra resources. Use the packaged Electron executable's Node runtime for the worker, a pinned prepared Chromium, explicit Remotion `binariesDirectory`, and a separately shipped esbuild executable. Preserve `import.meta.url` semantics when bundling into CommonJS. Build-time preparation records binary hashes, dependency metadata and notices. Render jobs make no browser downloads and use no host Chrome or source-checkout modules.

Retain system FFmpeg for timeline assembly. Remotion's bundled FFmpeg can encode the graphic but its filter set omits `overlay`, so it cannot replace ForgeCut's declared FFmpeg dependency. The packaged suite renders with the included Remotion binaries, then composites with `/usr/bin/ffmpeg` inside the same job namespace.

Use a separate sandboxed Electron renderer/session for component previews, with no preload bridge or Node integration, restricted resource serving, CSP, denied network/file requests, denied permissions and blocked navigation/window creation. Compile source without executing it in Node. Execute transformed components in that renderer or in the browser inside a Bubblewrap render namespace. Bubblewrap follows the namespace/mount pattern used by Flatpak, with an explicit read-only system/runtime view, a clean environment, separate networking and writable job/temp directories. A child process or JavaScript evaluator alone is insufficient isolation.

The Linux execution boundary fails closed if Bubblewrap/user namespaces are unavailable. macOS/Windows user-source execution requires an equivalent platform boundary and validation before it is enabled. This is an implementation decision, rather than a claim that this small fixture provides a comprehensive security audit.

## Verified results

The existing editor baseline passed all 92 tests, its production build and its Electron startup script. Existing React act warnings and media-method messages appear in the tests. The startup script succeeded but emitted GPU/shutdown diagnostics under Xvfb, so its exit status alone does not establish a clean production shutdown.

The integration fixture passed these checks:

- Packaged Linux x64 Electron execution with `appPackaged: true`, built assets and no development server.
- Remotion Player seeking to frame 15 and updating a component property from After dark to Your build.
- Local TTF and SVG image loading, plus visual inspection of the captured preview.
- Monaco TypeScript worker activation, valid TSX emission and syntax-error reporting.
- Playback of synthetic H.264/AAC media in MKV and MP4 containers.
- Transparent PNG/ProRes output and a one-second, 30-frame, 640 by 360 FFmpeg composite, with alpha and pixel checks.
- MCP STDIO discovery and a fixture tool call using the pinned official SDK.
- Packaged render worker, compiler, Chromium 157.0.8080.0, compositor and graphics assets launched from an unrelated temporary working directory.
- TSX compilation and custom component rendering inside the job namespace, with a real host sentinel file, environment secret and local host service remaining inaccessible.
- Compiled custom preview execution with Node imports, the editor bridge, host network and file reads blocked.
- Unsupported import rejection, a preview renderer terminated after an infinite loop while the editor remained responsive, and an export process tree killed on deadline followed by a successful render.

The real Octane recording was inspected with ffprobe and contains 1920 by 1080 H.264 at 60 fps and AAC audio. The playback probe used generated media with matching codec/container families; it does not establish long-recording seek accuracy or support for every MKV encoding. Derive playback proxies only when probing/playback shows they are needed, retaining original media for export.

Measured cgroup v2 process-tree peaks on this host:

| Check | Peak bytes | Approximate MiB |
| --- | ---: | ---: |
| Evaluation asset build, without minification | 2036727808 | 1942 |
| Packaged preview, workers and media check | 387096576 | 369 |
| Remotion render and FFmpeg composite | 806027264 | 769 |
| Complete packaged rendering and isolation suite, final run | 774443008 | 739 |

Each measured check had a 3221225472-byte memory maximum, a 2147483648-byte soft threshold, a 256 MiB swap limit and a CPU quota of 150000 per 100000 microseconds. Build and render Node heaps were limited to 1536 MiB. An earlier successful complete-suite run peaked at 1281540096 bytes, about 1222 MiB. These are small-fixture measurements, not a production capacity guarantee.

## Phase 0 completion and release requirements

The local evaluation satisfies Phase 0's packaged-preview, compiler, render-worker, media-compatibility and process-budget acceptance checks. The recorded implementation choices are the Linux baseline for later phases. The production editor and its dependencies are unchanged.

The licence investigation establishes distinct terms for Remotion, Monaco, the MCP SDK, Chromium and native FFmpeg. Generated notices retain available upstream texts and the font's installed licence. Remotion is source-available under its own terms; its FAQ distinguishes generated-code services from arbitrary-project rendering services. The selected product architecture remains a local desktop editor. A hosted rendering service would require a separate architecture and licence review.

Public distribution requires a release review of the applicable Remotion terms, complete Chromium/native third-party notices, and the exact corresponding-source/build materials for the distributed GPL FFmpeg libraries. The upstream FFmpeg source/build repository is [rust-ffmpeg-splitter](https://github.com/remotion-dev/rust-ffmpeg-splitter). The evaluation artifacts stay local and outside Git; production distribution clearance is not claimed by Phase 0.

Later phases must integrate the tested process boundaries with real job cancellation, asset grants, project revisions, source promotion and large recordings. Semantic React/Remotion type checking, Windows/macOS execution boundaries and a broader security review remain production implementation work. The namespace exposes read-only system libraries and fonts; it is not a dependency-free Linux container.

## Patterns and licences

[Official MCP SDK documentation](https://github.com/modelcontextprotocol/typescript-sdk) informs server factories, schemas and STDIO handling. The pinned packages declare Apache-2.0 and carry upstream notices including the MIT transition text. [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) establishes host transport/configuration support.

[Remotion parameterised videos](https://www.remotion.dev/docs/parameterized-rendering), [Player](https://www.remotion.dev/docs/player/player) and [Elements](https://www.remotion.dev/docs/elements) inform shared rendering inputs and exposed layers. Remotion uses its own [licence](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md); it is not covered by ForgeCut's MIT licence.

[Monaco](https://github.com/microsoft/monaco-editor) informs the embedded editor/worker setup and is MIT licensed. Preserve its bundled third-party notices when distributing compiled assets. The fixture's system font is an evaluation input; portable projects must collect font files and applicable notices explicitly.

[Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security) and [Bubblewrap](https://github.com/containers/bubblewrap) inform preview and render isolation. The host test used Bubblewrap 0.9.0 as a system executable. Remotion's [binaries directory](https://www.remotion.dev/docs/options/binaries-directory) and [ensureBrowser](https://www.remotion.dev/docs/renderer/ensure-browser) APIs inform packaging. Its [licence FAQ](https://www.remotion.dev/docs/license/faq) and [FFmpeg licensing notes](https://www.remotion.dev/docs/miscellaneous/ffmpeg-license) inform the release requirements above.
