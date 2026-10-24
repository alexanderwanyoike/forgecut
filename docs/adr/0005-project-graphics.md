# ADR 0005: Project-owned graphics and typed instance properties

Status: accepted for the graphics state and MCP contract. Player, rendering, fonts and custom code execution are subsequent slices.

A graphic instance references an exact component ID and content version. The project stores its TSX workspace, typed properties, stable property/layer IDs, design dimensions and dependency declarations. A SHA-256 version covers source, schema, layers, dimensions and dependencies. Instance text and geometry remain separate from source and can change without changing that version.

This follows Remotion parameterised rendering and the existing ForgeCut validated transaction/history boundary. Expected validation failures return the editing service Result. Unknown properties, invalid values, source paths outside the workspace, mismatched hashes and unresolved component references fail before state changes. Partial property patches preserve unrelated manual edits.

Project format 2 adds components and the RemotionGraphic item. Unversioned and version 1 projects migrate with an empty component collection. The initial packaged title template is copied into the project on first use. Saved source is data at this stage; loading a project never executes it. Later execution must use the isolated boundaries in ADR 0001.

The build copies the original TSX into the compiled graphics directory so component hashes agree in development and packaged builds. Fallow permits the backend-to-graphics edge because it reads source as a file, not as executable renderer code. Remotion dependencies are build dependencies because the renderer and worker are bundled; their applicable licences still accompany distribution.

Verification covers project round trips, rollback, property merge, undo, invalid source paths, stale asynchronous MCP reads, official SDK component discovery and graphic timeline selection. These checks establish the state contract, not completed graphics playback or export.
