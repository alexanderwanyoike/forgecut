# Span exports

## Decision

An export no longer renders as one FFmpeg graph that overlays every clip onto a black base. The planner splits the export interval into spans at every visual item boundary, so the set of visible items is constant within a span. A span that shows a single opaque, full-frame video clip (primary track, no transform) is a plain cut. It renders as trim, `fps`, scale-to-fit and pad (or crop for `cover`), with no RGBA conversion or overlay. Padding and cropping happen in 4:4:4 so odd centring offsets match the composited path. Every other span, including black gaps, text, images, prepared graphics, picture in picture and transformed clips, keeps the existing overlay graph, restricted to the items it shows. Adjacent composited spans merge into one process.

Each span renders to its own file with the preset's video encoder and exact frame count. A final process joins the span files with the [concat demuxer](https://ffmpeg.org/ffmpeg-formats.html#concat-1) and copies their video without re-encoding. Audio does not go through the span files. The mux renders it once, over the whole interval, from the same volume, fade and delay graph as before, so joins cannot introduce AAC priming gaps and envelopes stay sample-accurate.

Every source opens with an input-side seek to the first frame its span or range needs. Audio timestamps start at the clip's own elapsed time, so a fade that began before a review range continues at the right gain. A review range opens only the clips it overlaps and no longer decodes the sequence before its start. This replaces the output seek recorded in ADR 0012.

Spans render one at a time. Each process may use one thread per core of the media slice's 400% CPU quota and runs with that quota, rather than one thread at 150%. Memory now depends on the items a span shows, not on the number of clips in the sequence.

This follows the established pattern of rendering cut-only timelines without compositing. [MLT playlists](https://github.com/mltframework/mlt/blob/master/src/framework/mlt_playlist.c) seek only the clip under the playhead and the [tractor](https://github.com/mltframework/mlt/blob/master/src/framework/mlt_tractor.c) composites only where tracks overlap. Chunked encoders such as [Av1an](https://docs.rs/av1an-core/latest/src/av1an_core/concat/mod.rs.html) encode chunks separately, encode audio once and join with the concat demuxer, the approach also proposed in [Kdenlive issue 1868](https://invent.kde.org/multimedia/kdenlive/-/issues/1868). System FFmpeg remains an external process, no upstream implementation is copied and no dependency is added.

## Verification

Planner tests check plain and composited span boundaries, input-side seeks, range input selection and the concat mux. Rendered fixtures check exact frames, colours and continuous sound across a join, and odd-offset centring. The existing rendered export, review-range, audio-envelope, placement, preset and sequence-end fixtures pass unchanged.

On a generated 20-clip, 9 minute 20 second 1080p project on a 12-thread machine, a full export fell from 1232 s to 343 s and peak FFmpeg memory from 1.9 GB to 0.6 GB. A 20-second review range at five minutes fell from 441 s (first frame after 396 s) to 10 s (first frame after 1 s). Decoded audio is bit-identical to the previous renderer for both. Before encoding, the composited span of a 30-second review range is bit-identical to the previous graph's frames, and plain spans measure 45 to 51 dB PSNR against it, within encoder tolerance.
