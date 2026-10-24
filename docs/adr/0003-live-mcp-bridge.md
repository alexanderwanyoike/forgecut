# Live MCP editing bridge

Date: 24 October 2026.

Status: accepted; first Phase 2 slice implemented.

Electron retains the only writable project owner. A separate STDIO process uses the [official MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/) server and client packages at 2.4.0 (Apache-2.0, with their supplied licence texts retained). This updates the earlier Phase 0 evaluation pin to the current split-package API. The SDK owns MCP framing, validation and discovery. [Node HTTP over an operating-system socket](https://nodejs.org/api/http.html#httprequestoptions-callback) supplies the private application bridge rather than another TCP listener or a custom MCP implementation.

Sessions are explicit. Each running instance publishes an owner-only descriptor, with a random secret and Unix socket or Windows pipe address. Discovery omits credentials. Requests authenticate before reading bodies, are bounded to 1 MiB and use a short timeout. Project-targeted reads check the ephemeral project identity; edit batches additionally check revision and request identity through the existing editing service. A failed attachment clears the previous selection. No bridge path evaluates arbitrary code or exposes a shell.

Project summaries avoid cloning the complete project. Asset and timeline reads are paginated. Edit responses retain their original revision and changed item IDs on retries. The original project snapshots remain bounded by the Phase 1 history/deduplication budgets.

[esbuild](https://esbuild.github.io/api/#bundle) (MIT) produces a standalone CommonJS adapter, using Node built-ins at runtime. Packaging places it outside ASAR with the collected licence and notice texts from its actual bundled dependencies. The adapter smoke test copies only that file into an isolated directory before launching it, so source-checkout Node modules cannot satisfy its runtime dependencies.

The production bridge and maintained tests replace no discarded prototype. Follow-up Phase 2 work adds guarded history, session context, connection labels and cancellable jobs to this same owner. Full installer startup and non-Linux runtime checks remain distinct from the current Linux development Electron/STDIO integration check.
