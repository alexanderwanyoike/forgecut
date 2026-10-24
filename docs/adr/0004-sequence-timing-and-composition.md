# Sequence timing and composition

Date: 24 October 2026.

Status: shared timing resolver implemented; playback and export integration in progress.

The saved project retains integer microseconds. Resolve media at the project frame rate, using half-open frame ranges. Item start and end map to the first frame at or after the stored time; converting a frame boundary back to integer microseconds has a half-microsecond tolerance. Derive every source time from its frame offset, rather than adding rounded frame durations repeatedly. Source frame rates are sampled independently from the project frame rate. Track order supplies compositing order.

`get_sequence_frame` exposes active layers, source times, source assets, project settings and sequence duration through the existing validated editing service. Gaps return no layers; a frame at a cut belongs to the next item. This read does not modify project history.

The export integration follows FFmpeg's established [timeline filter and framesync patterns](https://www.ffmpeg.org/ffmpeg-filters.html): a bounded black/silent sequence base, trimmed and timestamped visual layers, half-open overlay enables, and independent delayed audio contributions. FFmpeg's [overlay implementation](https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/vf_overlay.c) informs explicit EOF behavior. System FFmpeg remains an external process under its applicable upstream licence; no upstream implementation is copied into ForgeCut. Preview and export will consume these same frame boundaries rather than separately deciding clip durations.

The next slices wire playback across gaps/cuts, geometry and audio envelopes, then real generated-media export checks. This decision does not claim those integrations are complete.
