# Export format presets

## Decision

Exports accept an optional `preset`: `mp4` (default, H.264/AAC) or `webm` (VP9/Opus). Both preserve sequence resolution, frame rate, composition and review-range timing. Format choice is an export option rather than project state. Queue fingerprints normalize the omitted preset to MP4 and retain the captured choice. Reusing a request ID with another preset fails deliberately.

The dialog offers one format picker, a matching save extension and the format of the current/last job. Controls are disabled while choosing a destination or rendering. Mismatched filename extensions fail with `INVALID_INPUT` before staging or replacing a file. Rendering retains the existing serial queue, subprocess resource budget, cancellation and atomic publication.

This extends ForgeCut's existing external FFmpeg pattern. The [official libvpx and libopus encoder documentation](https://ffmpeg.org/ffmpeg-codecs.html) and installed encoder help inform VP9 constant-quality mode (`crf=32`, zero target bitrate, good deadline, cpu-used=4) and Opus audio at 128 kb/s and 48 kHz. MP4 retains its existing CRF 23/AAC 192 kb/s settings. CRF values across encoders are not equivalent quality scales. The output audio sample rate may differ from the project for Opus's supported rates. No source code is copied and no new library is linked or bundled; existing FFmpeg distribution obligations remain unchanged.

## Verification

Generated portrait media exported through the editing service retains six review frames, VP9 picture and 48 kHz Opus audio from a 44.1 kHz project, without changing the project. A mismatched destination preserves the existing file and leaves no staging output. UI checks exercise format selection, matching save filters and captured job labels. Official MCP SDK requests verify explicit/default retry equivalence and changed-format rejection. Native acceptance exercises the picker, probes both encoded formats and inspects dark/light layouts at two window sizes.
