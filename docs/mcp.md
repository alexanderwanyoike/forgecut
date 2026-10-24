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

## Editing context and activity

`read_context` requires the current project session identity and returns stable selected item IDs, playhead microseconds and `contextRevision`. UI selection/playhead updates do not change the project revision or history. Deleting an item clears its selection, and switching projects resets transient context. Later edits must target explicit IDs rather than resolving an earlier request against a new selection.

The header reports local MCP bridge readiness and the latest successful action. These updates have their own ordered status revision. Readiness means the application bridge is available; host configuration and explicit instance selection are still separate steps.

## History and project files

`apply_history` takes `sessionId`, `expectedRevision`, `requestId` and `direction` (`undo` or `redo`). It uses the same bounded retry cache as edits, returns the original response on a retry and rejects reused IDs with different input.

`save_project` and `open_project` require the current session identity, expected revision and an absolute project path. Saving captures a snapshot before waiting for file I/O and returns the saved revision, which may precede later edits. It preserves the existing atomic save/recovery behavior. Opening validates the file before replacing the owner and returns a new project session identity. A failed open preserves the current project, and concurrent edits during loading reject replacement. File errors use structured `IO_ERROR` results.

## Media jobs

`start_import` takes the current project session/revision, a request ID and up to 32 absolute media paths. It returns a job immediately; `get_job` reports progress, status and a typed result containing created asset IDs. Retrying identical input and request ID returns the retained job, including after import changed the project revision. Changed input with a reused ID fails. A completed import is one undo action; concurrent manual edits reject a pending import without publishing partial assets.

`start_source_frame` takes the current project session/revision, a request ID, an imported visual asset ID and `timeUs`. Poll `get_job`; a completed frame returns a native JPEG image with metadata, rather than duplicating base64 into JSON. Images fit within 640 by 360 and 512 KiB. Missing assets, invalid source times and missing media tools return typed job failures.

`cancel_job` takes a job ID and its original project session. Queued jobs are removed immediately; running jobs enter `cancelling` until their process stops. Reads and cancellation remain scoped to the job's original session, even after a project switch. One worker runs at a time, with at most 16 active jobs and a two-minute deadline. Results are retained in memory within 64 jobs/8 MiB; old results may return `NOT_FOUND`. Normal application shutdown cancels and drains the queue. Export jobs and persistent queue recovery are added in later phases.

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
