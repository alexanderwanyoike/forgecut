# Shared editing state

Status: accepted. Phase 1 implementation.

Electron main owns the project and history. Edits use a private working copy, runtime validation, then one commit and notification. A rejected edit leaves the project, revision, undo and redo unchanged. History stores complete project snapshots, following the [Redux past/present/future pattern](https://redux.js.org/usage/implementing-undo-history/) (MIT). ForgeCut does not need Redux as a dependency for this small backend service.

History is limited to 100 entries and 32 MiB of serialized before/after data. Contiguous changes with the same interaction ID share an undo entry. Undo and redo close that interaction. An entry larger than the budget is committed without retaining history. These limits describe serialized history data, not total process memory.

[Zod](https://zod.dev/basics) (MIT, pinned at 4.3.6) validates project files and command inputs. Domain validation additionally checks references, unique IDs, track kinds, overlap and source bounds. Existing nonempty string IDs remain readable for compatibility; newly generated IDs use UUIDs. Files retain snake_case and the existing tagged item variants. Unversioned files migrate to schema version 1; future versions are rejected.

Persistence follows same-directory temporary-file replacement, as used by [write-file-atomic](https://github.com/npm/write-file-atomic) (ISC). ForgeCut writes and syncs the temporary file, renames it, and syncs the directory on Linux. Saves are serialized and capture the project at invocation. A valid previous primary is first retained as `.forgecut.bak`; a corrupt primary cannot replace that recovery copy. Recovery is explicit. Missing media does not invalidate an otherwise valid project and is reported by asset ID.
