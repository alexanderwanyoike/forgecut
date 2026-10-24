# Named project sequences

Date: 24 October 2026.

Status: persistence, native lifecycle and explicit sequence targeting implemented. Visual sequence navigation and MCP sequence tools follow separately.

## Decision

Keep media, graphic component versions and owned resources at project scope. Give each sequence its own name, identity, settings and timeline. This follows the project-bin and independent-sequence model documented by [Kdenlive](https://docs.kdenlive.org/en/project_and_asset_management/project_bin/sequence.html) and the shared-producer/container model in [MLT](https://mltframework.org/docs/mltxml/). No upstream code is copied and no MLT runtime is introduced; ForgeCut retains its existing resolver and FFmpeg/Remotion pipeline.

Project format 3 adds `default_sequence` metadata for the existing root `settings` and `timeline`. Additional sequences live in `sequences`, each with its own settings and timeline. The default timeline remains stored once in its existing location, preserving the production editor's current timeline contract while giving it an explicit sequence identity and name. Additional sequences share references to the project's assets and graphics instead of duplicating media.

Valid unversioned, format 1 and format 2 documents migrate on load. Their timeline, settings, assets, resources and component data remain unchanged. Generate default-sequence metadata only when it is missing, and save the generated identity so subsequent validation/reopen preserves it. Format 3 requires this metadata. Future formats remain rejected.

Allow at most 32 sequences including the default. Reuse one timeline/settings schema for every sequence. Validate track/item identities globally, media references against the shared asset table, and graphics/resources for every timeline. Invalid references, duplicate identities, incompatible tracks, overlapping items or invalid graphics reject the entire candidate before publication.

## Verification

Maintained tests cover all three legacy input forms, stable migration identities, missing media references and duplicate identities in additional sequences. A public AppState save/reopen workflow retains sequence names, dimensions, markers and item content. Existing atomic-file recovery checks now expect the current format 3.

## Shared sequence commands

Native create, list, rename and delete commands use stable sequence IDs. Creation generates a UUID and inherits project settings unless the request supplies overrides. The list response contains identity, name and settings; timelines remain available through project/timeline reads. Default-sequence deletion is rejected, and deleting an additional sequence retains shared assets and component/resource definitions.

Creation, renaming and deletion participate in the existing guarded batch and project history. One batch renaming several sequences creates one revision and one undo action. The editing service returns each native handler's declared result after publishing its validated working copy, allowing creation to return the new sequence identity. No additional state owner or history store is introduced.

## Context and explicit targets

Keep the canonical project in the existing state owner. Selecting a sequence changes session context, never creative revision or project history. Cache each sequence's playhead, item selection and graphic-layer selection until it is deleted or the project changes. A separate sequence revision orders snapshot responses across switches, including switches that share the same creative project revision.

Multi-sequence timeline edits must provide a sequence ID. A transaction selects its explicit target only in its working copy, then rechecks that target before every timeline operation. An agent can edit another sequence without changing the human's active sequence. Deleting a target earlier in the same batch rejects later operations and rolls back the batch rather than redirecting them into the default sequence. Context writes must name the currently active sequence so delayed writes cannot replace another sequence's selection or playhead.

The renderer bridge attaches the active sequence ID from its latest accepted snapshot. Both bridge and project hook reject older sequence revisions at the same creative revision. Explicit sequence timeline and frame reads use that sequence's settings. Graphic item IDs remain globally unique: draft lookup searches every sequence, and isolated graphic preview uses the owning sequence's dimensions, frame rate and duration.

History remains chronological across the project, with an optional owning sequence on each action. Groups coalesce only within the same sequence. Undo and redo reject a mismatched sequence before consuming an action; snapshots expose the next action's sequence. Global project changes remain global actions. Restoring independent whole-project snapshots out of order would erase later changes in other sequences, so selective per-sequence history is not introduced. Bounded history bookkeeping is composed into the existing state owner; it does not own a second writable project.

Maintained service and renderer workflows cover context restoration, unchanged creative state on switches, explicit agent edits, delayed snapshots, stale context rejection, portrait geometry, scoped history and deletion rollback. A real isolated preview regression verifies the owning sequence's dimensions and frame bounds. Sequence navigation UI, MCP sequence tools, cross-sequence source promotion and export selection remain subsequent integration slices.
