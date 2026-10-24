# Project credits and provenance

## Decision

Reuse the `ResourceLicense` record already used by imported artwork and fonts (ADR0005). An optional asset `license` records recording, music or image provenance: an identifier, full licence/permission text, optional attribution and source URL. Absence means no metadata was recorded. It does not imply permission or public-domain status. Existing graphic resources continue to require their licence record.

`set_asset_license` replaces an asset's metadata, or removes it when explicitly passed null. `set_resource_license` replaces artwork/font metadata without changing its UUID, content hash, path or references. Both are global project edits, support guarded `apply_edits` and global undo, and leave media bytes, timing and sequence contents unchanged. Replacing a record is explicit; clients must preserve drafts and refresh after concurrent edits rather than silently overwriting another editor's work.

Project format 7 adds optional asset licences. Supported formats through 6 migrate without inventing credits and retain sequence and item identities. Older editors reject the new format before replacing an open project. Reuse the existing validation bounds: identifier 256 characters, notice 65,536 characters, attribution 2,048 characters and source URL 2,048 characters. No dependency or copied upstream implementation is introduced; this extends the existing imported-resource pattern.

MCP asset pages include only the bounded licence identifier and omit attribution, source URL and notice text. `read_asset_credit` returns one bounded full notice, or null when absent; existing `read_graphic_resource` supplies font/artwork notices. Shared edit capabilities expose both update operations. Read identity/revision before editing and reread after conflicts.

## Verification

Native service and official MCP SDK workflows cover save/reopen, global undo, independent sequence contents, removing asset metadata, resource content identity, missing IDs, invalid notice/URL rollback, stale revisions and sessions, and identical retries within the bounded request cache. Asset-list transport checks use 100 maximum-length escaped notices, identifiers and attributions, and the single-notice response remains below the local 1 MiB limit. Visual controls are a separate delivery slice.
