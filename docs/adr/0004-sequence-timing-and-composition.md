# Sequence timing and composition

Date: 24 October 2026.

Status: shared timing resolver and timeline-positioned FFmpeg composition implemented; export job controls implemented; playback and geometry/audio integration in progress.

The saved project retains integer microseconds. Resolve media at the project frame rate, using half-open frame ranges. Item start and end map to the first frame at or after the stored time; converting a frame boundary back to integer microseconds has a half-microsecond tolerance. Derive every source time from its frame offset, rather than adding rounded frame durations repeatedly. Source frame rates are sampled independently from the project frame rate. Track order supplies compositing order.

`get_sequence_frame` exposes active layers, source times, source assets, project settings and sequence duration through the existing validated editing service. Gaps return no layers; a frame at a cut belongs to the next item. This read does not modify project history.

The export integration follows FFmpeg's established [timeline filter and framesync patterns](https://www.ffmpeg.org/ffmpeg-filters.html): a bounded black/silent sequence base, trimmed and timestamped visual layers, half-open overlay enables, and independent delayed audio contributions. FFmpeg's [overlay implementation](https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/vf_overlay.c) informs explicit EOF behavior. System FFmpeg remains an external process under its applicable upstream licence; no upstream implementation is copied into ForgeCut. Preview and export will consume these same frame boundaries rather than separately deciding clip durations.

The next slices wire playback across gaps/cuts, geometry and audio envelopes, then real generated-media export checks. This decision does not claim those integrations are complete.

## Timeline export slice

The export compiler now uses the shared frame ranges, a bounded black/silent base, track-ordered overlays and sample-delayed independent audio. It does not require a primary video or audio stream. Still images retain their single source frame for their half-open interval. Text is written to private temporary files with expansion disabled, so punctuation and line breaks are literal data. System FFmpeg decoder, encoder and filter threads are limited to one. Existing music fades remain until explicit envelope controls are added.

Maintained generated-media checks verify the exported leading gap, silent picture cuts, continuous music samples, frame count, title-only ending, still-image opacity and literal punctuation. Prior concat/filter-label assertions were removed because they fixed the obsolete implementation rather than establishing rendered behavior. Export job snapshots, process-tree budgets, cancellation and atomic output remain the next slice.

Review found two export integration regressions, now covered by real rendered fixtures. Activation compares the rounded project-frame index derived from FFmpeg time, rather than converting frame boundaries back to rounded microsecond timestamps. Source timestamps shift by an exact frame/rate expression; secondary frames are retained only within the explicit interval. Input paths become absolute before the child changes into its private text directory, preserving supported relative source paths. Distinct colour frames check cuts at upward- and downward-rounded boundaries.

## Export jobs and publication

Both UI and MCP start exports through the same serial queue, retaining the owner's immutable project revision. Editing or opening another project does not change a queued export, and scoped job reads/cancellation remain valid for its original session. Exports have a 15-minute deadline; import/frame deadlines remain two minutes. The dialog can be closed while work continues and reopened with the same job state.

Rendering stages an MP4 beside its destination, syncs it and atomically renames it only after successful completion. Cancellation stops the actual FFmpeg process and cleans staging before releasing its queue slot. The short final publication has an explicit `committing` state: cancellation returns `COMMITTING` rather than claiming that a published file was cancelled. Application shutdown awaits that publication. Typed Results describe export and process failures. The obsolete progress-event forwarding and Electron-specific backend IPC wrapper were removed; the shell now calls the pure service directly.

On Linux with an active user systemd manager, export FFmpeg executes in a transient scope with the Phase 0 memory/CPU profile: 3 GiB hard memory, 2 GiB soft memory, 256 MiB swap and 150% CPU. The [systemd resource-control model](https://freedesktop.org/software/systemd/man/latest/systemd.resource-control.html) supplies the process-tree controls. Scope execution preserves the spawned process identity, so AbortSignal stops the actual FFmpeg process. An integration test reads the live cgroup files and verifies all limits. On platforms without that manager, trusted FFmpeg exports retain serial execution, single codec/filter threads and deadlines; equivalent hard memory/CPU enforcement is not claimed. Untrusted component execution still follows the separate fail-closed Phase 6 isolation decision.
