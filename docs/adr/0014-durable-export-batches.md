# Durable serial export batches

## Decision

Capture up to 32 distinct sequence exports into a new dedicated directory. Save one immutable `project.forgecut` snapshot, owned graphic-resource sidecars and `batch.json` with the project hash, revision, output names, preset and entry status. Keep media references external until project collection is implemented. Creating or resuming a batch never changes the live editor, its history or its current sequence. Saved batch files are bounded to 8 MiB; transport reads return metadata, not project source.

This extends the existing AppState save format, fsync-and-rename atomic writer and serial media JobQueue. [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile), already used for graphic drafts, supplies its established mkdir/heartbeat ownership pattern under the existing MIT licence. No new dependency or copied upstream implementation is introduced. A process handles one active batch; each output uses the shared queue's export deadline, cancellation, resource budget and atomic publication.

The directory must not already exist. Validate captured project/session revisions before creation and reject duplicate saved entry identities, sequences or destinations. A hash check rejects an edited captured project before resuming. Explicit batch IDs prevent stale controls from resuming a different batch at the same path. The current editor may change or open another project while a captured batch is running.

## Restart and cancellation policy

Startup does not automatically render. Read a saved batch and explicitly resume it. Completed entries are skipped. A running entry whose owner lock has expired is interrupted. Retrying interrupted, cancelled or failed entries requires `retryInterrupted: true`; the whole output is rerendered and may replace an earlier published file. Recovery is at output boundaries, never at a partial encoded frame. A crash after output publication but before its completion checkpoint can therefore require an explicit rerender.

Each entry uses its own deterministic temporary directory derived from the persisted UUID. Recovery removes only that exact directory while holding the batch lock; unrelated temporary directories remain untouched. Ordinary exports keep their existing random staging. Staging creation never adopts or cleans a pre-existing directory on failure.

Pause cancels the current queued/rendering job where possible and retains the remaining entries. An output already committing finishes atomic publication. Shutdown stops new resumes and waits for active cancellation; restarting requires another explicit resume. Each retry uses a fresh in-memory media-job identity while retaining the saved batch/entry identity.

## Verification

Public editing-service workflows capture snapshots without changing the editor, export actual landscape/portrait files after manual project changes, skip completed output files, restore an interrupted saved record, remove only its owned partial directory, and reject colliding records. Additional workflows cover cross-owner locking, queued cancellation, same-editor retry and shutdown during resume. The official MCP SDK exercises creation, stale-session rejection, reading after a project switch, resuming and pausing. Native packaged acceptance exercises the IPC endpoints and probes actual captured WebM output dimensions and frame counts. Visual batch controls follow in a separate focused change.
