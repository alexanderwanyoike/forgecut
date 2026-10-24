# Graphic source compilation

Date: 24 October 2026.

Status: source checking, isolated rendering/preview, recoverable drafts and guarded promotion implemented. The code tab follows in Phase 6.

## Decision

Compile project TSX in a separate, bounded process. Use the existing pinned esbuild 0.25.12 plugin API to resolve only the supplied workspace files and the approved React, Remotion and font-loader imports. TypeScript 5.9.3 checks user files in strict mode through a virtual CompilerHost. Its only files are the supplied source and prepared type declarations; it does not fall back to reading the host filesystem. Vendor declaration checking is skipped, while user source checking remains strict.

The existing component workspace limits apply: 32 files, 128 KiB per file and 512 KiB total. Compiled code is limited to 2 MiB, compiler output to 4 MiB, diagnostics to 100 entries and checking to 15 seconds. Cancellation terminates the compiler process tree. The existing Linux user-scope CPU/memory budget also applies where available. Compilation parses and transforms source without executing it. This process separation does not substitute for the execution boundary required before custom preview or promotion is enabled.

The native check returns a typed compilation Result with located diagnostics. Operational failures retain the command Result boundary. MCP starts checking through the existing serial, cancellable job queue and returns diagnostics without returning the compiled bundle. The active project and its history remain unchanged.

Prepare the worker, esbuild executable, API module, type declarations and notices during the build. Keep esbuild's API external to the worker bundle, following its own packaging requirement, and supply its prepared executable explicitly. Package these files outside ASAR. Tests prepare this small runtime before running, so a fresh checkout does not depend on an earlier application build. No compiler or type-library downloads happen while checking a project.

## Upstream patterns and licences

The [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) informs the virtual host and diagnostics. TypeScript is Apache-2.0 licensed. The [esbuild plugin API](https://esbuild.github.io/plugins/) informs workspace resolution; esbuild is MIT licensed. The prepared runtime retains their licence texts and the notices for the shipped React, CSS and Remotion declarations. Remotion's own terms and the public-release requirements in ADR 0001 continue to apply.

## Verification

Maintained tests check a local TSX import, strict type errors, syntax errors and forbidden Node imports. A top-level sentinel proves source is not executed during checking. An official MCP SDK workflow checks the actual packaged title source through the running owner's job queue. The compiled STDIO/native Electron smoke also checks source from an unrelated working directory. These checks establish compilation and transport, not custom-code execution isolation.

## Graphics filesystem and network boundary

All graphics jobs now use an explicit system/runtime view rather than binding the host root. The Bubblewrap view contains read-only system libraries/tools/fonts, the prepared runtime and executable directory. Writable host access is limited to the private job directory; temporary files have a private `/tmp`. Jobs receive a clean environment and separate process, network, IPC and hostname namespaces. Parent-death handling and the existing process-tree cleanup remain in force. This follows the namespace/mount pattern documented by [Bubblewrap](https://github.com/containers/bubblewrap), also used in ADR 0001.

A maintained real worker probe attempts to read a host sentinel outside its grants, connect to a host loopback service, read an inherited environment secret and overwrite its runtime. All four are denied while its job output is writable. Existing detached-child cancellation/crash checks and real font/artwork renders remain passing. The namespace policy applies to the existing renderer now; enabling custom components still requires its own runtime and promotion checks.

Per-file source limits are measured in UTF-8 bytes as documented, rather than JavaScript string length. A Unicode regression covers a file below the character limit but above 128 KiB.

## Project component rendering

The prepared rendering composition can now load a checked project component through an explicit CommonJS package map for React, its JSX runtimes, Remotion and the font loader. Evaluation happens only in the graphics execution zone inside the restricted browser worker. Fallow prevents the editor renderer from importing that zone. The Function constructor is enabled only in this loader's lint override because evaluating a compiled project module is its current responsibility; application code retains the normal rule.

Unrecognised component versions are content-hash checked and compiled before rendering. Declared dependency versions must match the prepared runtime. Source remains separate from instance properties, so a property edit does not rewrite source. Built-in components retain their prepared-source digest check.

Project code additionally requires the existing Linux systemd user scope with CPU and memory limits. If that scope cannot be established, execution returns unavailable; there is no unbounded fallback. Existing built-in rendering retains its supported process-ownership fallback. Custom frames use Remotion's supported minimum timeout of seven seconds, with the outer owned-process deadline and cancellation remaining in force. These are Linux execution guarantees; other platforms remain disabled until an equivalent boundary is validated.

Maintained real-render checks cover custom source at exact frames, changed instance values, save/reopen, absence of Node capabilities and the editor bridge, runtime errors, nonterminating code, dependency mismatches and preservation of the previously approved destination. A separate boundary test verifies that project code is refused without its resource scope. Browser compatibility shims such as Remotion's `window.process.env` are distinguished from Node capabilities.

## Isolated interactive preview

Reuse the prepared headless Chromium browser for custom preview rather than granting a separate Electron renderer access to the desktop display socket. The browser stays inside the same filesystem, network, PID and resource boundary as export. It has no application preload. A private loopback server serves only the prepared preview bundle; its CSP denies connections, frames and workers, and allows supplied image/font data URLs. Chromium executes the same checked component and Remotion Player used by rendering.

A persistent owned worker accepts bounded frame requests. Four prepared component contexts and four pending contexts are retained; a newer queued frame replaces the old one for the same context. Startup is limited to 15 seconds and a frame to seven seconds. Project switches abort preparation and terminate the worker. Application shutdown awaits worker cleanup. Preview results are PNGs bounded to 960 pixels per side and 518400 pixels total; project code never executes in the editor renderer.

The maintained Linux test checks two exact frames, changed preview-only properties, unchanged project/history, and a warm frame update below one second. This uses Remotion's existing browser/CDP interfaces and avoids a second renderer runtime or desktop-socket exception.

Preview waits for the pinned Remotion runtime's outstanding `delayRender` handles as well as Player buffering, fonts and image readiness. An asynchronous component regression proves it captures the completed frame. Runtime exceptions and a nonterminating component are followed by a successful recovery render. Lifecycle tests interrupt startup during shutdown/reset and restart a worker after an idle crash, retaining temporary-directory ownership until cleanup finishes.

All budgeted compiler, preview and media scopes run under `forgecut-media.slice`. Set its runtime-only aggregate limits through the user service manager before starting a scope: 3 GiB hard memory, 2 GiB high watermark, 256 MiB swap and 150% CPU. Each scope retains its individual bounds, while the slice prevents concurrent preview/export processes from multiplying the total allowance. If aggregate setup fails, project-code execution remains unavailable. Serial export/analysis jobs remain queued; interactive preview may run within that same aggregate budget. A real cgroup test checks both the child scope and its parent limits.

## Recoverable drafts

Store source drafts separately under the user's private ForgeCut draft directory, keyed by project and graphic instance. Native read/save/revert commands do not change active source or project history. Save compares a separate draft revision; Revert writes the active component through a newer revision rather than deleting the counter. Invalid TSX remains recoverable. An active component-version mismatch requires reconciliation or Revert.

Use [proper-lockfile 4.1.2](https://github.com/moxystudio/node-proper-lockfile), MIT licensed, for the filesystem lease around reading, comparing and atomically writing a draft. This extends the existing atomic-write/revision pattern across application instances without implementing a new lock protocol. All writers use the same ten-second stale threshold and five-second heartbeat. Contention returns a conflict; abandoned leases become recoverable. Lease and cleanup failures return typed errors, and cleanup diagnostics retain an existing failure. Files are bounded to 4 MiB and created with private permissions.

## Guarded source promotion

Apply runs through the serial cancellable job queue. Build a candidate project without changing active state, validate its dependency and schema contracts, then check each affected instance's first and last frame in the isolated runtime. This samples runtime behaviour; it cannot prove arbitrary code works at every frame. A syntax/type or runtime failure preserves active source and history.

Default to a new project-local component identity for the selected instance. A shared update explicitly targets instances pinned to the selected component version. Preserve values by stable property IDs, including renamed property keys, and retain compatible layer states. Removed/replaced IDs and changed property types require explicit mappings or discards; a null mapping requests the new default or removes the old layer state. Reject collisions and invalid migrated values. Declared image/font dependencies must exist and are supplied alongside property resources, without granting unrelated project files.

Compilation does not hold the draft lease or block manual editing. At publication, briefly take the lease and recheck the draft revision, session and project revision. Enter the job's commit barrier and publish one project/history change. Undo restores the previous component versions and instance data; draft undo remains separate. An error releasing the lease after a successful project commit is reported as a warning on the successful job rather than claiming the source was not applied.

## Packaged editor origin

The packaged UI loads from the secure standard `forgecut-app://editor/` origin selected in ADR 0001. Electron serves only built UI assets beneath its real resolved distribution directory, with a MIME allowlist, a 32 MiB asset limit and symlink/traversal checks. The CSP allows same-origin workers and required project image/font/media protocols while denying frames, objects, forms and arbitrary script evaluation. Development retains its explicit Vite URL.

Long recordings keep their separate streaming `forgecut-media` handler and Range responses. Static UI loading does not read media into memory. The Linux unpacked/ASAR smoke test asserts the application origin and checks the existing UI, MCP, audio, graphics export and canvas workflow.

## Component property types

Custom source can annotate its input with the ambient `ForgeCut.Props` interface. Its `values` fields follow the component property schema, including literal unions for select options, with resource and layer-state contracts alongside them. Generate declarations from validated metadata and supply them as a virtual compiler library. Do not add generated files to the project's source or change its content hash merely to check types.

Preview, export and promotion all pass the component schema into the same compiler. Standalone native/MCP source checks accept optional `properties` for the same API. The pure declaration generator is also available to the forthcoming Monaco integration. Existing source with its own props declarations remains supported. Runtime execution still receives ordinary values and the same restricted resource map; ambient types grant no runtime capabilities.

## Native code editor support

The native editor can read approved package declarations from the prepared code runtime. Bound that fixed file to 8 MiB and return only its virtual package paths, leaving standard libraries to Monaco and excluding host Node declarations. This read does not expose arbitrary filesystem paths and requires no network request or package download.

Draft preview builds the same candidate and migrations as Apply, then renders one requested frame in the isolated preview worker. It does not publish the candidate. Check the project/session and draft revisions before and after rendering so a late image cannot replace the user's newer work. Package-type and draft-preview commands remain native editor APIs; the MCP transport keeps its smaller bounded source reads and existing jobs.

## Monaco code workspace

Load Monaco 0.57.0 only when the user opens Edit code for a graphic. Keep the surrounding Inspector and timeline available. The editor follows Monaco's standalone models, language-service extra libraries, editor opener and Vite module-worker pattern. Include only the TypeScript/JavaScript and JSON languages and the completion/definition contributions needed here, rather than the full VS Code workbench. Monaco is MIT licensed; its licence and third-party notices are included with the prepared code runtime.

Each source file has a virtual file URI. The shared property declaration generator supplies a read-only `ForgeCut.Props` model, and the native API supplies the approved offline package declarations. Preserve literal package path characters when registering extra libraries so scoped package resolution works. Language activation is asynchronous; wait a bounded five seconds for the TypeScript service before reporting readiness. Use Monaco's textarea input path for the supported Electron version. Editor theme changes update Monaco in place.

The renderer may import the pure shared declaration generator at runtime; the contract zone still cannot import backend code, and the isolated execution zone remains forbidden to the renderer. No project code executes in Monaco or the application renderer.

Serialize draft autosaves using acknowledged revisions. A conflicting agent write retains the local buffer, with explicit choices to load the saved draft or merge only edited files over its latest metadata. Clean agent changes appear without reopening the editor. Finish pending saves before leaving Code, opening another project or closing the window. A late Apply refresh cannot overwrite typing made after that request began.

Preview renders a requested draft frame through the existing isolated native path and retains the last good image on syntax or runtime failure. Apply uses the guarded native promotion job, reports progress/cancellation and defaults to one instance; shared scope shows its affected instance count. Successful Apply advances the saved draft's base to the new active version so editing can continue. Monaco draft undo remains independent from project undo. Schema migration mappings are explicit; per-instance content and positioning remain in Properties.

The isolated preview CSP permits `fetch` of embedded `data:` font resources because the pinned font loader reads those bytes before constructing the font. Network connections remain denied by the CSP and namespace boundary. A real owned-font preview regression covers this grant.

## Located runtime failures

Emit an inline esbuild source map with each checked bundle, without copying source contents into that map. The existing 2 MiB compiled-output limit includes the map. Give evaluated project bundles the fixed `forgecut-component.js` source URL. Retain the original exception stack through the isolated Player error path.

Use `@jridgewell/trace-mapping` 0.3.31's `TraceMap` and `originalPositionFor` API to translate the first project stack frame, accounting for the Function constructor's two wrapper lines. This follows the library's maintained source-map consumer pattern instead of implementing a mapping decoder. The dependency is MIT licensed; the prepared preview worker's dependencies now participate in the runtime notice collection.

Only relative workspace source names produce a location. Missing, malformed or unresolvable mappings retain the ordinary runtime error. Bounded optional diagnostics travel through the worker, native command and MCP error contracts. Monaco receives the same typed locations as compilation diagnostics, with clickable navigation for Preview and Apply failures. A late response is associated with its requested draft epoch rather than newer typing.

A real isolated-render regression throws inside an imported helper and checks its original file, line and column. UI service tests cover both Preview and Apply failures preserving active state. The packaged smoke clicks the runtime diagnostic and verifies focus returns to the source editor.
