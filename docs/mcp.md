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

If an instance disappears, tools return `UNAVAILABLE`. List sessions and explicitly attach again. Opening another project changes its project session identity; reads and writes using the old identity fail. Local credentials are never returned by MCP tools.

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

This first Phase 2 slice provides session selection, capability discovery, bounded project reads and live guarded edit batches. MCP history commands, save/load controls, editing-context reads, visible connection/action status and cancellable media jobs are the next Phase 2 slice. These tools are not advertised yet.

`yarn --cwd apps/forgecut_gui/ui test` exercises the real local bridge and official SDK. `yarn --cwd apps/forgecut_gui/ui verify:electron` additionally starts a real STDIO child with an isolated copy of the adapter bundle, edits Electron's project and checks the rendered project name. Use Xvfb on headless Linux and an isolated Vite port when another development server is running. This checks the built adapter and development Electron application; full installer validation remains a separate check. Windows/macOS runtime transport has not been manually verified here.
