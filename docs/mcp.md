# Live editing through MCP

Start ForgeCut with `yarn --cwd apps/forgecut_gui/ui dev`. Build the adapter with `yarn --cwd apps/forgecut_gui/ui build:electron`. Node 22 is the development and test baseline.

For a source checkout, the STDIO command is:

```sh
yarn --silent --cwd /absolute/path/to/forgecut/apps/forgecut_gui/ui mcp
```

`--silent` keeps Yarn banners out of the MCP protocol stream. The adapter does not launch ForgeCut or choose a project automatically. It lists running instances, then requires an explicit `attach_session` call.

## Codex configuration example

The following example follows the [official Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). Replace the path with the checkout containing this implementation. This is an example only; implementation does not edit global Codex configuration.

```toml
[mcp_servers.forgecut]
command = "yarn"
args = ["--silent", "--cwd", "/absolute/path/to/forgecut/apps/forgecut_gui/ui", "mcp"]
```

Run `list_sessions`, explicitly select an `instanceId`, and call `attach_session`. Read `get_capabilities` for operation schemas and limits. `read_project` returns the current project `sessionId` and revision. Pass that session identity to paginated asset, timeline and item reads. Timeline ranges are half-open intervals in integer microseconds. Reads are limited to 100 records and every local message is limited to 1 MiB.

Submit `apply_edits` with the current identity, expected revision, a unique request ID, a short action label and supported operations. The editor validates and commits one batch, publishes one change and retains one undo action. The result includes created, changed and removed timeline item IDs. On `CONFLICT`, read the latest state before creating another request. Retry an uncertain successful request with its original ID and identical input. Deduplication retains its original revision and changed IDs within the existing bounded in-memory window.

`add_clip_to_timeline` accepts optional `sourceInUs` and `sourceOutUs` for video and audio clips. Omitted bounds retain the full-source defaults. Use these fields to assemble several short ranges in one atomic batch without creating overlapping full-length clips first. Ranges must be positive, within the source duration and compatible with their destination tracks. Invalid operations roll back the complete batch.

If an instance disappears, tools return `UNAVAILABLE`. List sessions and explicitly attach again. Opening another project changes its project session identity; reads and writes using the old identity fail. Local credentials are never returned by MCP tools.

## Source selections

`read_source_selections` reads a page of source-relative footage choices with stable IDs, names, notes and rationale. Supply `sessionId` and optional `assetId`, `offset` and `limit` (at most 20). Unknown asset IDs and stale project identities return typed errors.

Use `save_source_selection` within `apply_edits` to create a pick or replace one by `selectionId`. Supply `assetId`, `name`, integer `sourceInUs`/`sourceOutUs`, `notes` and `rationale`. Read first and preserve manually changed fields before replacing a record. Positive ranges must fit the probed audio/video duration. `delete_source_selection` removes a pick by `selectionId`. Picks are shared project metadata, so these operations do not require a sequence target. Existing revision, retry, undo and file persistence rules apply.

`update_source_selection` changes only supplied fields on an existing `selectionId`. Its nonempty `patch` accepts `name`, `source_in_us`, `source_out_us`, `notes` and `rationale`. Prefer a partial patch when changing a range or one note so other manual fields are retained. Bounds and references are validated on the merged record; invalid changes publish nothing. Existing session/revision/retry/global-history rules apply.

## Editing context and activity

`read_context` requires the current project session identity and returns stable selected item IDs, playhead microseconds and `contextRevision`. UI selection/playhead updates do not change the project revision or history. Deleting an item clears its selection, and switching projects resets transient context. Later edits must target explicit IDs rather than resolving an earlier request against a new selection.

The header reports local MCP bridge readiness and the latest successful action. These updates have their own ordered status revision. Readiness means the application bridge is available; host configuration and explicit instance selection are still separate steps.

## Named sequences

`read_project` includes `sequenceCount`, `defaultSequenceId`, `activeSequenceId` and `sequenceRevision`. `read_sequences` returns a bounded page of stable IDs, names and settings. This follows the existing MCP SDK tools and paginated read pattern; the editor remains the only project owner.

For projects with multiple sequences, pass `sequenceId` to `read_timeline`, `read_sequence_frame`, sequence edits, history and exports. Omitting it from timeline/frame reads returns `INVALID_INPUT` rather than inferring a target from the visible editor. Single-sequence reads retain their original defaults. `read_item` searches globally unique item IDs and returns their owning `sequenceId`; supply a sequence ID to restrict the lookup.

Explicit reads and edits leave the user's active sequence unchanged. To intentionally switch the visible editor, call `select_sequence` with the project session, target sequence ID and `expectedSequenceRevision` from a fresh context or sequence read. A stale activation epoch returns `CONFLICT`, including when the user switched away and back. Selection changes transient context, not the creative revision or undo history. Ordinary edit and history requests retain their existing revision and retry guards.

## Independent landscape and portrait variants

Use `create_sequence_variant` in `apply_edits` with `sourceSequenceId`, a name and optional settings overrides. The copied sequence, tracks and items receive fresh IDs. Shared project assets and exact graphic component versions are retained. `read_sequences` exposes `variantSourceSequenceId`, and copied items include `origin_item_id` in ordinary timeline/item reads.

Edits remain independent. To deliberately copy current source timing to selected copied items, use `sync_variant_timing` with `itemIds` and target the variant through the edit request's `sequenceId`. It preserves variant wording, crop, props, media and source in points. It aligns starts and durations; video/audio out points follow their existing in points plus that duration. Invalid bounds or overlaps reject the whole batch. The existing revision, retry and sequence history rules apply. Missing source sequences/items return typed failures while keeping the independent variant usable.

## History and project files

`apply_history` takes `sessionId`, `expectedRevision`, `requestId` and `direction` (`undo` or `redo`). It uses the same bounded retry cache as edits, returns the original response on a retry and rejects reused IDs with different input.

`save_project` and `open_project` require the current session identity, expected revision and an absolute project path. Saving captures a snapshot before waiting for file I/O and returns the saved revision, which may precede later edits. It preserves the existing atomic save/recovery behavior. Opening validates the file before replacing the owner and returns a new project session identity. A failed open preserves the current project, and concurrent edits during loading reject replacement. File errors use structured `IO_ERROR` results.

## Media jobs

`start_import` takes the current project session/revision, a request ID and up to 32 absolute media paths. It returns a job immediately; `get_job` reports progress, status and a typed result containing created asset IDs. Retrying identical input and request ID returns the retained job, including after import changed the project revision. Changed input with a reused ID fails. A completed import is one undo action; concurrent manual edits reject a pending import without publishing partial assets.

`start_source_frame` takes the current project session/revision, a request ID, an imported visual asset ID and `timeUs`. Poll `get_job`; a completed frame returns a native JPEG image with metadata, rather than duplicating base64 into JSON. Images fit within 640 by 360 and 512 KiB. Missing assets, invalid source times and missing media tools return typed job failures.

`cancel_job` takes a job ID and its original project session. Queued jobs are removed immediately; running jobs enter `cancelling` until their process stops. Reads and cancellation remain scoped to the job's original session, even after a project switch. One worker runs at a time, with at most 16 active jobs and a two-minute deadline. Results are retained in memory within 64 jobs/8 MiB; old results may return `NOT_FOUND`. Normal application shutdown cancels and drains the queue. Export jobs are now available; persistent queue recovery remains Phase 7 work.

## Export jobs

`start_export` takes `sessionId`, `expectedRevision`, `requestId` and an absolute `outputPath`. It captures that immutable revision immediately and returns a job, so manual editing and project switches cannot alter its output. Identical retained requests return the same job. `get_job` and `cancel_job` use the job's original session identity. Export rendering has a 15-minute deadline; the shared queue remains serial.

A render writes staging files beside its destination and publishes the complete MP4 by atomic rename. Cancel before publication to preserve an existing destination. A `committing` job is finishing publication; cancellation returns `COMMITTING`, and callers should poll for its final result. Normal application shutdown cancels active renders and waits for publication already in progress.

The UI export dialog uses the same queue, shows status/progress and supports cancellation. Close it to keep editing, then reopen it to inspect the retained job. An evicted result leaves the dialog available for another export.

The Linux systemd user-manager path enforces the resource profile documented in [ADR 0004](adr/0004-sequence-timing-and-composition.md), verified here against real cgroup files. Other environments retain thread/deadline/serial limits without claiming equivalent hard memory/CPU controls. Untrusted custom component execution has a separate fail-closed boundary.

## Packaged adapter

Packaging copies `mcp-adapter.cjs` and `mcp-notices.txt` into the installation's resources directory, beside `app.asar`. The standalone CommonJS adapter contains its JavaScript dependencies. Start it with Node 22, passing the absolute path to `resources/mcp-adapter.cjs`; its working directory does not need to contain the source checkout. Build dependencies are not duplicated in the installed application's Node modules.

The packaged Electron executable can also run the adapter using its included Node runtime, avoiding a separate Node installation. This path was verified with the Linux unpacked build:

```toml
[mcp_servers.forgecut]
command = "/absolute/path/to/installation/forgecut"
args = ["/absolute/path/to/installation/resources/mcp-adapter.cjs"]
env = { ELECTRON_RUN_AS_NODE = "1" }
```

The default registry is `$XDG_CONFIG_HOME/forgecut/mcp-sessions`, falling back to `~/.config/forgecut/mcp-sessions`. `FORGECUT_MCP_DIR` overrides it for both application and adapter, including isolated tests. The application publishes owner-only descriptors and a private socket directory. Windows uses a named pipe. A per-instance random secret authenticates local requests. Only supported editing operations are exposed.

## Scope and verification

This first Phase 2 slice provides session selection, capability discovery, bounded project reads and live guarded edit batches. Guarded `apply_history`, `save_project` and `open_project` controls are also available. `read_context` now reports selection and playhead with an independent context revision. The editor header shows bridge readiness and the latest successful MCP action. Cancellable imports and source-frame jobs are available. The automated three-range manual/agent editing workflow now passes through the official SDK and live owner. Human acceptance in the desktop editor remains part of reviewing this stack.

`yarn --cwd apps/forgecut_gui/ui test` exercises the real local bridge and official SDK. `yarn --cwd apps/forgecut_gui/ui verify:electron` additionally starts a real STDIO child with an isolated copy of the adapter bundle, edits Electron's project, imports generated media through a job and checks both the rendered project name and asset bin. Use Xvfb on headless Linux and an isolated Vite port when another development server is running. This checks the built adapter and development Electron application; full installer validation remains a separate check. Windows/macOS runtime transport has not been manually verified here.

## Resolved sequence reads

`read_sequence_frame` takes an explicit `sessionId`, `sequenceId` for multi-sequence projects, `playheadUs` and optional `offset`/`limit` (maximum 100). It returns the current revision, project frame/duration/settings and a page of active layers. Frame-snapped source positions support paused picture inspection; continuous playback positions and audio gains support the running sequence. A black gap has no visual layers. This read uses the same pure resolver as preview and does not change history.

Source and music gain, mute and fades are exposed through the typed `update_item` patches advertised by `get_capabilities`. Time fields remain integer microseconds, and manual changes use the same guarded history as MCP edits.

`set_sequence_end` is also available inside `apply_edits`: supply `endUs` as a positive integer or `null` to follow the content duration. Read `read_sequence_frame` for the resolved duration and frame count. This changes the sequence boundary without trimming any timeline item.

Visual `update_item` patches support a complete video `transform`, image `fit` and integer `layer_order` on video/image/text items. Read `read_sequence_frame` for the resolved placement and compositing order. The `get_capabilities` schemas list every supported field. Full video transforms retain explicit fit and opacity alongside position/size; changes remain guarded by the expected project revision.

## Graphics state

`list_graphic_templates` returns the packaged component schema and editable layer metadata. Create an instance with `add_graphic_item` in `apply_edits`, then use `read_graphic_component` for its exact stored version. `update_item` with a `RemotionGraphic` property patch merges only the supplied keys. The standard identity, revision, retry and history rules apply. Source bodies remain project data until the isolated code execution phase.

## Project fonts and artwork

`start_resource_import` queues a font/artwork import with `sessionId`, `expectedRevision`, `requestId` and a `resource` object. Supply an absolute file path, kind, and either licence metadata or an absolute licence-text path. An optional target supplies only the graphic item ID and property name; the owner carries the request's original identity through the job. Retry the identical request ID to recover its job.

`read_graphic_resources` returns up to 20 metadata records per page without binary data or full licence text. `read_graphic_resource` returns one exact record, including retained licence text. Import results identify the new resource; ordinary typed graphic property patches can select existing project fonts.

Imports use the same `committing` barrier as export publication. Once that short project commit starts, cancellation returns `COMMITTING` and the job completes with its actual result. Cancellation cannot claim that an already committed import was discarded.

Resource and licence imports accept regular files only. Nonblocking opens reject pipes before they can occupy the serial queue, and bounded reads check cancellation between chunks. Each resource is limited to 8 MiB.

## Source drafts and Apply

`read_graphic_source` targets an explicit item and session. Choose `view: "draft"` (the default) or `"active"`. Without a file it lists filenames, byte counts, the entry and current draft/base revisions. Supply `file` to read one source body, limited to 128 KiB. Set `includeMetadata` when editing the draft's property/layer schemas or dependencies; source bodies remain separate.

`patch_graphic_draft_file` saves or removes one file using `expectedDraftRevision` and the active `baseVersion`. It preserves other files and schema changes. `save_graphic_draft` replaces the complete component draft when schema changes are intentional. The 1 MiB transport limit still applies; use per-file reads/patches for larger workspaces. Conflicts require rereading and reconciling, and never authorize overwriting a manual buffer. `revert_graphic_draft` replaces the draft with active source through a newer draft revision. These operations leave active graphics and project history unchanged.

`start_graphic_source_check` returns located compilation diagnostics without executing source. `start_graphic_promotion` queues Apply using the expected project and draft revisions plus a unique request ID. Poll `get_job`; cancellation uses `cancel_job`. Default scope forks the selected instance. Explicit shared scope targets instances pinned to its original component version. Property/layer migration maps use stable old IDs and new IDs, or null to explicitly discard/reset a value. Successful Apply creates one project undo action. Source execution requires the supported Linux isolation and aggregate resource boundary. No arbitrary package installation or shell execution is exposed.

## Source range review jobs

`start_source_review` queues a `contact-sheet` or `waveform` for an imported `assetId`, `startUs` and `endUs`. Supply the originating `sessionId`, `expectedRevision` and unique `requestId`. A range is between 100 milliseconds and 30 seconds and must fit the probed source. Review longer recordings in successive bounded ranges. Contact sheets require video; waveforms require an audio stream.

`get_job` returns a 4 by 3 contact sheet as native JPEG image content, with the asset/range, twelve sample-target times and byte count in its metadata. Sampling can repeat source frames when the source frame rate is lower than the sample rate. A waveform contains at most 512 min/max bins at an 8 kHz sample rate, with its range and samples per bin. Both operations retain the project and its history.

The implementation composes [FFmpeg's documented fps, scale, pad and tile filters](https://www.ffmpeg.org/ffmpeg-filters.html) through the existing cancellable media-process runner. Outputs are bounded to 512 KiB. An in-memory cache retains at most 64 results and 8 MiB; keys include source path/identity, size, modification time, range and review kind. Source bounds are checked before cache lookup. Changed files invalidate cached results, including a file change detected while rendering. Restarting the app clears this derived cache. Existing job timeout, retry and cancellation rules apply.

## Project styles

`read_style_presets` returns up to 20 card/ending style identities, canvas sizes, exact component versions and captured layer/placement settings. The project summary includes `stylePresetCount`.

`read_style_preset` pages the saved property values for one preset ID, with at most five properties per response. Use `offset` and the returned `total` to inspect the complete style without creating a timeline item. This lower bound keeps maximum-length text properties within the local transport limit. Both reads require the current project session and return its creative revision.

Use `save_style_preset` in `apply_edits` with an explicit `sourceSequenceId`, graphic `itemId`, `name` and `purpose` (`card` or `ending`). An optional `presetId` deliberately replaces an existing style. `delete_style_preset` takes its preset ID. These are global history actions; existing instances retain their own values and component versions.

`add_graphic_from_preset` takes `presetId`, `trackId`, `timelineStartUs`, `durationUs` and optional property `overrides`. Target the destination `sequenceId` in the guarded batch. Bound geometry adapts from the captured canvas; explicit overrides apply last. Later instance edits remain independent of the saved style.

Project credits reuse the artwork/font licence shape for recording, music and image assets. `read_assets` includes only the bounded `license.identifier`; attribution, source URL and full `text` are omitted. Use `read_asset_credit` with the current session and asset ID for one complete notice; an uncredited asset returns `license: null`. Font/artwork details remain available through `read_graphic_resource`. Guarded `apply_edits` supports `set_asset_license` (null explicitly removes metadata) and `set_resource_license` (a complete record is required). Both are global history actions and do not modify media or sequence contents.
