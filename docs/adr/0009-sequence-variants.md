# Independent sequence variants

## Decision

Creating a variant copies an existing sequence's timeline and settings into an independent named sequence. The copy receives new sequence, track and timeline-item IDs while sharing the project's media, artwork, fonts and exact component versions. Creation is one global undo action and leaves the visible sequence unchanged. Width, height and frame rate can be overridden for portrait or landscape output.

This uses the existing named-sequence owner and ordinary deep value copying, informed by [OpenTimelineIO's clone/deepcopy model](https://opentimelineio.readthedocs.io/en/latest/api/python/opentimelineio.core.html). ForgeCut uses its existing JavaScript structured cloning and UUID identities; the reference introduces no dependency or copied implementation.

`variant_source.sequence_id` records the copied sequence. Each copied timeline item retains `origin_item_id` pointing to the source item at copy time. These are provenance, so deleting a source sequence or source item does not invalidate an independently edited variant. The originating item remains visible in ordinary bounded item/timeline reads. Generic splits retain that provenance when cloning an item.

Variants change independently. The explicit `sync_variant_timing` operation targets selected item IDs in one variant and reads their originating sequence's current timing. It copies timeline starts and durations. It preserves the variant's media choice, source in point, wording, graphic properties, visual crop, layer states and audio settings. Video/audio out points follow their retained in point plus the synchronized duration. Existing complete-project validation rejects unavailable source duration, overlaps or invalid fades atomically. Unselected items and the source sequence stay unchanged.

Missing origins and mismatched item kinds return typed failures. Timing sync is scoped to the target sequence and uses existing creative revision, retry and history guards. It does not traverse further variant ancestry or propagate changes automatically.

Project format 5 retains variant metadata and origin IDs. Supported older files migrate without replacing existing sequence identities, source selections or content. Old editors reject the newer version before replacing their project.

## Verification

A native workflow copies portrait settings, edits its crop/source trim/position, edits the original timing, explicitly synchronizes one copied item and undoes that sync without losing either side's edits. It also checks exact save/reopen. An official MCP SDK workflow discovers sequence/item origins and retains manually changed wording when an agent synchronizes timing.
