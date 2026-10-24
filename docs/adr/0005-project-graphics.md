# ADR 0005: Project-owned graphics and typed instance properties

Status: accepted for the graphics state and MCP contract. Player, rendering, fonts and custom code execution are subsequent slices.

A graphic instance references an exact component ID and content version. The project stores its TSX workspace, typed properties, stable property/layer IDs, design dimensions and dependency declarations. A SHA-256 version covers source, schema, layers, dimensions and dependencies. Instance text and geometry remain separate from source and can change without changing that version.

This follows Remotion parameterised rendering and the existing ForgeCut validated transaction/history boundary. Expected validation failures return the editing service Result. Unknown properties, invalid values, source paths outside the workspace, mismatched hashes and unresolved component references fail before state changes. Partial property patches preserve unrelated manual edits.

Project format 2 adds components and the RemotionGraphic item. Unversioned and version 1 projects migrate with an empty component collection. The initial packaged title template is copied into the project on first use. Saved source is data at this stage; loading a project never executes it. Later execution must use the isolated boundaries in ADR 0001.

The build copies the original TSX into the compiled graphics directory so component hashes agree in development and packaged builds. Fallow permits the backend-to-graphics edge because it reads source as a file, not as executable renderer code. Remotion dependencies are build dependencies because the renderer and worker are bundled; their applicable licences still accompany distribution.

Verification covers project round trips, rollback, property merge, undo, invalid source paths, stale asynchronous MCP reads, official SDK component discovery and graphic timeline selection. These checks establish the state contract, not completed graphics playback or export.

## Built-in preview and hybrid export

Player is lazy-loaded, paused and sought by the shared sequence clock. The preview accepts the exact packaged source and dependency set, and explicitly sizes/crops the composition for contain/cover placement. Typed Properties controls merge instance edits, including RGBA colours without discarding alpha.

The graphics worker renders transparent ProRes 4444 using the packaged Remotion browser/compositor, then exits before system FFmpeg assembles footage and audio. The immutable export snapshot supplies source, settings, properties and frame ranges. Intermediates remain in the export staging directory and only the final existing atomic publication path can replace the destination. No persistent graphics cache is introduced; each export regenerates its inputs. A runtime source digest prevents an older prepared bundle from rendering a newer component silently. Unrecognised project source is rejected until isolated custom execution is implemented.

`yarn build:graphic-runtime` prepares the browser, composition, native binaries, worker and notices at build time. Package commands include it and put the runtime beside ASAR. Runtime browser downloads are disabled. The worker uses the existing Linux user-scope CPU/memory policy when available, graceful cancellation and a bounded process-tree termination fallback. Linux generated-media checks cover real rendering and cancellation while preserving the destination. macOS/Windows builds remain checked; native graphics acceptance on those systems remains outstanding.

The native Electron preview exposed React 18 ref warnings in the pinned Remotion AbsoluteFill helper. The title uses equivalent positioned divs while retaining Remotion frame hooks. This avoids suppressing diagnostics or changing the application's React version.

## Process ownership correction

A detached Chromium process can outlive its Node worker, so killing only the worker process group is insufficient. A regression reproduced both forced cancellation and worker crashes without a systemd user scope. Graphics export now requires Linux Bubblewrap PID namespaces with parent-death handling; the existing user scope additionally bounds CPU/memory where available. The namespace ends detached descendants before the broker closes and staging cleanup proceeds. Other platforms report graphics export unavailable until equivalent native ownership is validated; ordinary FFmpeg exports remain supported. Linux packages declare Bubblewrap and CI tests the no-systemd path. This uses [Bubblewrap's namespace lifecycle](https://github.com/containers/bubblewrap), as evaluated in Phase 0. The trusted built-in worker receives read-only host files plus its writable staging directory; this is an ownership boundary, not the custom-source security policy required by Phase 6.

## Project-owned resource persistence

Graphic resources retain a UUID, content hash, MIME type and licence/provenance metadata in the project. Imports copy supported font/image bytes into an app-owned content-addressed store before the guarded project commit. Imports are bounded to 8 MiB each; unknown formats and stale project identities fail without changing history. Instances will reference resource IDs, so choosing a different font or image remains an instance edit.

Saving writes immutable bytes into `.forgecut-resources/<sha256>` beside the manifest before replacing the manifest. Relative references and licence text travel with the project. Reopening verifies resource hashes and hydrates the app store; missing/corrupt resources produce an actionable load failure while preserving the current open project. Backups and undo can continue referencing older immutable files. No original asset path is required after import.

The resource-persistence slice exposes import through the shared IPC command. Resource pickers, MCP import jobs and component rendering inputs follow in the next graphics slices. A maintained generated-PNG test moves the manifest/resource folder, clears the app cache and reopens without the original artwork.

## Font selection and identical rendering inputs

A font property references a project resource ID. Importing a font and selecting it for a graphic is one guarded transaction and one undo action; the component source/version stays unchanged. The font's licence can be supplied as metadata or a local text file. Unknown references and resource-kind mismatches fail before the project changes.

Preview serves only hash-checked resources belonging to the current project through a dedicated resource protocol. Export reads the same immutable bytes into bounded data inputs for its offline worker. The pinned Remotion font loader registers a family derived from the content hash, with shared inputs in Player and renderMedia. Player waits for font preparation before mounting the composition and seeks to the current local frame when ready. Loading failures are visible and exports preserve the old destination. The explicit system sans-serif choice remains available when no project font is selected.

The Inspector provides project-font selection and import with licence text. Native Linux acceptance loads an actual font, verifies document font registration, saves/reopens its resource references and exports the card through the job queue. CI supplies a redistributable system font for this check; private Octane assets remain outside the repository.
