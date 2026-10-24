# Sequence timing and composition

Date: 24 October 2026.

Status: Phase 3 sequence timing, continuous playback, audio, framing, explicit ends and queued exports are implemented with automated acceptance on Linux. Human visual/listening acceptance remains for stack review.

The saved project retains integer microseconds. Resolve media at the project frame rate, using half-open frame ranges. Item start and end map to the first frame at or after the stored time; converting a frame boundary back to integer microseconds has a half-microsecond tolerance. Derive every source time from its frame offset, rather than adding rounded frame durations repeatedly. Source frame rates are sampled independently from the project frame rate. Track order supplies compositing order.

`get_sequence_frame` exposes active layers, source times, source assets, project settings and sequence duration through the existing validated editing service. Gaps return no layers; a frame at a cut belongs to the next item. This read does not modify project history.

The export integration follows FFmpeg's established [timeline filter and framesync patterns](https://www.ffmpeg.org/ffmpeg-filters.html): a bounded black/silent sequence base, trimmed and timestamped visual layers, half-open overlay enables, and independent delayed audio contributions. FFmpeg's [overlay implementation](https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/vf_overlay.c) informs explicit EOF behavior. System FFmpeg remains an external process under its applicable upstream licence; no upstream implementation is copied into ForgeCut. Preview and export consume the same frame boundaries rather than separately deciding clip durations.

The sections below record the completed playback, audio and export slices. The visual placement section records the remaining framing integration.

## Timeline export slice

The export compiler now uses the shared frame ranges, a bounded black/silent base, track-ordered overlays and sample-delayed independent audio. It does not require a primary video or audio stream. Still images retain their single source frame for their half-open interval. Text is written to private temporary files with expansion disabled, so punctuation and line breaks are literal data. System FFmpeg decoder, encoder and filter threads are limited to one. Legacy music defaults retain 100 ms entrance/exit fades; explicit item envelopes now override them.

Maintained generated-media checks verify the exported leading gap, silent picture cuts, continuous music samples, frame count, title-only ending, still-image opacity and literal punctuation. Prior concat/filter-label assertions were removed because they fixed the obsolete implementation rather than establishing rendered behavior. Export job snapshots, process-tree budgets, cancellation and atomic output are covered below.

Review found two export integration regressions, now covered by real rendered fixtures. Activation compares the rounded project-frame index derived from FFmpeg time, rather than converting frame boundaries back to rounded microsecond timestamps. Source timestamps shift by an exact frame/rate expression; secondary frames are retained only within the explicit interval. Input paths become absolute before the child changes into its private text directory, preserving supported relative source paths. Distinct colour frames check cuts at upward- and downward-rounded boundaries.

## Export jobs and publication

Both UI and MCP start exports through the same serial queue, retaining the owner's immutable project revision. Editing or opening another project does not change a queued export, and scoped job reads/cancellation remain valid for its original session. Exports have a 15-minute deadline; import/frame deadlines remain two minutes. The dialog can be closed while work continues and reopened with the same job state.

Rendering stages an MP4 beside its destination, syncs it and atomically renames it only after successful completion. Cancellation stops the actual FFmpeg process and cleans staging before releasing its queue slot. The short final publication has an explicit `committing` state: cancellation returns `COMMITTING` rather than claiming that a published file was cancelled. Application shutdown awaits that publication. Typed Results describe export and process failures. The obsolete progress-event forwarding and Electron-specific backend IPC wrapper were removed; the shell now calls the pure service directly.

On Linux with an active user systemd manager, export FFmpeg executes in a transient scope with the Phase 0 memory/CPU profile: 3 GiB hard memory, 2 GiB soft memory, 256 MiB swap and 150% CPU. The [systemd resource-control model](https://freedesktop.org/software/systemd/man/latest/systemd.resource-control.html) supplies the process-tree controls. Scope execution preserves the spawned process identity, so AbortSignal stops the actual FFmpeg process. An integration test reads the live cgroup files and verifies all limits. On platforms without that manager, trusted FFmpeg exports retain serial execution, single codec/filter threads and deadlines; equivalent hard memory/CPU enforcement is not claimed. Untrusted component execution still follows the separate fail-closed Phase 6 isolation decision.

Cleanup remains inside the Result boundary. Failed rendering/cancellation retains its original error code and gains a cleanup diagnostic. A published success remains successful with an optional `cleanupWarning`; the queued result preserves that diagnostic. Real permission denial and filesystem fault injection cover both cases.

## Playback and editable audio

A monotonic sequence clock crosses picture cuts, black gaps and title-only endings. Preview reads the current owner snapshot through the pure resolver, with composition dimensions scaled into the viewport. MCP `read_sequence_frame` exposes a bounded page of the same active layers and source positions, guarded by project session identity. Old video-clock reads and production jsdom exceptions were removed.

Audio uses continuous sequence time independently of picture frame rate. The resolver retains a frame-snapped source position for paused video and a continuous playback position for running media and paused audio seeks. Source and music clips expose volume (0 to 4), mute and integer-microsecond entrance/exit fades. Fade lengths clamp to the resolved clip duration; overlapping fades multiply. Legacy source audio defaults to unity gain without fades, while music keeps its existing 100 ms fades. Unprobed source audio stays silent in both preview and export.

Preview follows the established browser [MediaElementAudioSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/MediaElementAudioSourceNode) to [GainNode](https://developer.mozilla.org/en-US/docs/Web/API/GainNode) graph, using one lazily created AudioContext for the preview. This supports gain above the HTML media volume limit and keeps an independent music element alive across picture cuts. Each source disconnects on removal; the context closes with the preview. Native play interruptions after pause are discarded, and genuine warnings are scoped to the current source snapshot.

The same envelope settings compile to FFmpeg volume/afade filters. Maintained generated-tone tests compare decoded export amplitudes against resolver gains between frames in a 1 fps project. Renderer checks cover music continuity, mute, gain, seek, pause and cleanup. A native Electron smoke observes non-silent Web Audio samples through the actual project media protocol. These checks establish signal/timing behavior, with manual listening still part of editorial acceptance.

## Explicit sequence ends

An optional `timeline.duration_us` sets the sequence end without trimming its items. The typed `set_sequence_end` operation accepts a positive integer time or `null` to follow content again. It participates in the same history, persistence and UI/MCP revision guards as other edits. The resolver rounds the requested end to the first project frame at or after it, matching item end semantics, and returns no active layers after that resolved end.

The Inspector accepts seconds, with a blank value selecting automatic duration. The timeline shows an explicit end marker and includes long tails in its scroll/fit bounds. Export keeps exactly the resolved number of frames, fills an extended tail with black/silence, and does not open source files whose items start wholly after the end. Item envelopes retain their own durations when the sequence cuts them short. Real FFmpeg fixtures verify frame counts, a black tail and an unavailable source outside the export interval.

## Shared visual placement

Video clips may store a complete `transform` (X/Y, width/height, `contain` or `cover`, opacity). Legacy primary and secondary clips resolve to their previous full-frame and quarter-frame PiP defaults until changed. Images expose the same fit rules while retaining their existing serialized geometry. Video, image and text items accept an optional integer `layer_order`; its default is the track index, with stable item order breaking ties. Changing visual stacking does not move tracks or change legacy PiP defaults.

The pure domain resolver supplies both ordering and placement to preview and export. Stored coordinates retain their precision; both renderers round rectangle positions and dimensions to composition pixels, with dimensions at least one pixel. Editing another property preserves the original stored transform values. Inspector controls use shared numeric validation, and all edits use the existing history/revision boundary exposed to MCP.

FFmpeg follows its documented [scale, crop, pad and overlay filters](https://www.ffmpeg.org/ffmpeg-filters.html). `contain` keeps transparent padding; `cover` crops centrally. Composite layers in RGB before the final YUV420 conversion, so subsampling cannot round odd overlay coordinates down. The preview uses the matching CSS object-fit and transparent letterboxing. No upstream implementation is copied.

Maintained rendered fixtures compare crop, fit, alpha, placement and layer order, including video and image rectangles at odd X/Y coordinates. Renderer checks use the same resolved composition coordinates, and shared-service checks cover legacy defaults, undo and invalid-input rollback. These complete the Phase 3 automated checks; manual motion and listening review remain part of desktop acceptance.
