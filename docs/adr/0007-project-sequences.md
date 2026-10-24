# Named project sequences

Date: 24 October 2026.

Status: file-format and persistence boundary implemented. Sequence editing, context and MCP integration follow in the next slice.

## Decision

Keep media, graphic component versions and owned resources at project scope. Give each sequence its own name, identity, settings and timeline. This follows the project-bin and independent-sequence model documented by [Kdenlive](https://docs.kdenlive.org/en/project_and_asset_management/project_bin/sequence.html) and the shared-producer/container model in [MLT](https://mltframework.org/docs/mltxml/). No upstream code is copied and no MLT runtime is introduced; ForgeCut retains its existing resolver and FFmpeg/Remotion pipeline.

Project format 3 adds `default_sequence` metadata for the existing root `settings` and `timeline`. Additional sequences live in `sequences`, each with its own settings and timeline. The default timeline remains stored once in its existing location, preserving the production editor's current timeline contract while giving it an explicit sequence identity and name. Additional sequences share references to the project's assets and graphics instead of duplicating media.

Valid unversioned, format 1 and format 2 documents migrate on load. Their timeline, settings, assets, resources and component data remain unchanged. Generate default-sequence metadata only when it is missing, and save the generated identity so subsequent validation/reopen preserves it. Format 3 requires this metadata. Future formats remain rejected.

Allow at most 32 sequences including the default. Reuse one timeline/settings schema for every sequence. Validate track/item identities globally, media references against the shared asset table, and graphics/resources for every timeline. Invalid references, duplicate identities, incompatible tracks, overlapping items or invalid graphics reject the entire candidate before publication.

## Verification

Maintained tests cover all three legacy input forms, stable migration identities, missing media references and duplicate identities in additional sequences. A public AppState save/reopen workflow retains sequence names, dimensions, markers and item content. Existing atomic-file recovery checks now expect the current format 3.
