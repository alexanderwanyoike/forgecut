# Editing service

The application backend owns project state. Electron main creates one `AppState` and one `EditingService`; renderer components receive committed snapshots. Future adapters should call the service and subscribe to the same owner.

## Reading and editing

`execute("get_project_snapshot")` returns the project, its ephemeral `sessionId`, monotonic `revision`, undo/redo availability and missing-media asset IDs. Every service call returns `{ ok: true, value, sessionId, revision }` or `{ ok: false, error: { code, message } }`.

Use `apply_edits` for a guarded batch:

```ts
const response = await service.execute("apply_edits", {
  sessionId: snapshot.sessionId,
  expectedRevision: snapshot.revision,
  requestId: crypto.randomUUID(),
  operations: [
    { command: "update_project", args: { settings: { fps: 24 } } },
    {
      command: "update_item",
      args: {
        itemId: titleId,
        patch: { kind: "TextOverlay", changes: { text: "A first look", x: 120 } },
      },
    },
  ],
});
```

On `CONFLICT`, read the latest snapshot and reconsider the edit before submitting a new request ID. On `PROJECT_CHANGED`, select/read the intended session again. Retry an uncertain successful request with its original request ID and original contents. Deduplication is bounded to 128 requests and 8 MiB, and resets on process restart. It does not provide durable exactly-once delivery.

Each operation must be valid in order. File I/O, probing and exports are excluded from synchronous batches. Imports stage their results and commit together once the originating session is checked again. Probing continues in the background if the session changes, but its results are discarded. Cancellation and externally visible job IDs belong to Phase 2.

## Undo and notifications

A successful batch is one undo entry and one project notification. Optional `editGroup` IDs coalesce consecutive batches from the same interaction. The renderer uses fresh IDs when focusing a field or beginning a slider gesture. A drag or trim commits once on mouse release. Undo/redo, another edit group or a project switch separates interactions.

History covers assets, settings and timeline data. It retains at most 100 entries and 32 MiB of serialized snapshots. Oversized entries are not retained. Runtime state such as playhead, selection, playback, file paths used for saves and missing-file status is not creative history.

The owner freezes committed data. Consumers receive detached snapshots and cannot mutate the project through a query result. Notifications cannot roll back an already committed edit if a listener fails.

## Project files

Files use `schema_version: 1`. Unversioned valid files migrate on load and gain a version when saved. Future versions and invalid references/timing are rejected before the current project is replaced. Missing source files are reported while preserving the project and its timeline.

Saving writes a temporary file beside the destination, syncs it and atomically renames it. Linux also syncs the containing directory. Before replacement, a valid previous file is copied to `<project>.forgecut.bak`. After a failed open, the editor offers **Open recovery copy**. A backup is available after a previous valid save has been replaced. An interrupted first save either leaves its prior primary intact or leaves no completed project file.

Autosaves keep the five most recent snapshots per project in the operating system temporary directory under `forgecut-autosave`. These can be opened through **File > Open Project**. They are not yet listed in a recovery browser.
