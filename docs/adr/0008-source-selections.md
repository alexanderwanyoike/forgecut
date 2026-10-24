# Source selections

## Decision

A source selection is a named, positive half-open range in an imported recording's own time coordinates. It has a stable ID, asset reference, in/out microseconds, notes and rationale. Selections are project data shared by all sequences; saving or deleting one is a global history action. They can describe useful footage before it is placed on a timeline.

This follows the established distinction between source-relative media ranges and parent timeline ranges in [OpenTimelineIO's time range model](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/docs/tutorials/time-ranges.md). The implementation uses ForgeCut's existing microsecond representation and guarded editing service. The reference informs the data model; it adds no dependency or copied implementation.

An audio/video selection requires probed positive source duration, and its out point cannot exceed it. IDs are unique across the project. References remain valid when deleting or relinking assets because the complete candidate project is validated before publication. Invalid changes retain the preceding project and history.

Project format 4 adds `source_selections`. Format 3 upgrades preserve the existing default sequence identity and all timelines. Older supported versions retain their established default-sequence migration. Invalid or future formats fail before replacement. Old editors reject format 4 rather than silently discarding editorial notes.

`save_source_selection` creates a selection or replaces an explicitly identified one. `update_source_selection` merges a nonempty typed field patch, retaining untouched editorial fields and validating the complete resulting range. `delete_source_selection` removes an identified selection. These commands use the same atomic edits, expected revision, retry cache and undo history as other project changes. Callers must read the current record before replacing it so manual notes are preserved.

`read_source_selections` returns at most 20 records, optionally filtered by asset ID. There are at most 1000 selections per project; notes and rationale are each limited to 2000 characters. Pagination happens inside the editor before transport serialization. Bounded cached contact-sheet and waveform jobs are available through native/MCP source review. Short video previews remain a separate production slice.

The asset bin opens a source monitor for probed audio and video. Its inspector creates saved in/out ranges and edits names, notes and rationale through partial updates. Append selection inserts the saved range at the end of a chosen compatible track in the visible sequence, using an expected-revision batch and one undo step. Insertion copies the range into an independent timeline clip and retains the saved selection.

## Verification

Native editing tests cover range validation, unchanged timelines/context, notes, stable updates, undo/redo and save/reopen. The official MCP SDK workflow reads a manually changed note, retains it while adjusting the selected source range, and retries the same guarded request without publishing a second edit. Migration tests retain default sequence identity and reject corrupt metadata.

The packaged Electron workflow decodes generated footage, creates a saved range, preserves manual notes through an agent range patch, inserts and undoes a clip, and reopens the source monitor. Layout checks cover dark/light at 1280 and 1024 pixels.
