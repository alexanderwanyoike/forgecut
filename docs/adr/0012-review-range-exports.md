# Review-range sequence exports

## Decision

An export may include a requested `range` with integer microsecond start/end values. The range must fall within its captured sequence, last between 0.1 and 30 seconds, and contain at least one sequence frame. Both ends align to the existing frame-at-or-after rule. Invalid ranges return a typed `INVALID_INPUT` before staging or replacing a file. Full-sequence export remains the default.

The pipeline retains original sequence, graphic and audio-envelope clocks. It uses [FFmpeg's documented output seek](https://ffmpeg.org/ffmpeg.html) after composition and limits output frame count/duration. It does not rebase clips or restart animations/fades. The tradeoff is that graphic preparation and decoding before the selected range can still occur. Existing export deadlines, resource controls, cancellation, staging and atomic publication remain in force. This extends the external FFmpeg pattern already in use; no implementation is copied or new dependency bundled.

The shared range policy validates both the export and its visual controls. Project-specific frame validation occurs on the immutable export view. A queued job captures its sequence, range and destination; MCP retries include range in the job fingerprint, so changing range with the same request ID fails deliberately.

The export dialog starts with a full export. Review a range exposes time fields initialized around the captured playhead, validates locally, and forwards the selected sequence/range. Reopening clears a prior review draft. In-flight exports retain their captured range while editing continues.

## Verification

Generated footage changes from red to blue and carries a continuous audio fade. Exporting a fractional-frame interval verifies exact output frame count, the expected picture and the original audio-gain phase. Invalid, out-of-bounds and empty-frame ranges preserve existing files and leave no staging directory. MCP tests cover range retry identity, and dialog workflows cover captured targets, invalid values and reopening.
