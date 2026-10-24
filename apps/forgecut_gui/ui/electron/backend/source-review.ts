import type { Asset } from "../shared/ipc-contract.js";
import type {
  SourceReview,
  SourceReviewRequest,
} from "../shared/source-review.js";
import type { Result } from "../shared/result.js";
import {
  cachedSourceReview,
  retainSourceReview,
} from "./source-review-cache.js";
import { computePeaks, mediaCacheId } from "./media-derived.js";
import { runMediaProcess } from "./media-process.js";

async function renderSourceReview(
  asset: Asset,
  request: SourceReviewRequest,
  signal: AbortSignal,
): Promise<Result<SourceReview>> {
  const durationUs = request.endUs - request.startUs;
  const metadata = {
    assetId: asset.id,
    startUs: request.startUs,
    endUs: request.endUs,
  };
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-threads",
    "1",
    "-filter_threads",
    "1",
    "-ss",
    String(request.startUs / 1_000_000),
    "-t",
    String(durationUs / 1_000_000),
    "-i",
    asset.path,
  ];
  if (request.kind === "contact-sheet") {
    args.push(
      "-an",
      "-vf",
      `setpts=PTS-STARTPTS,fps=12000000/${durationUs}:start_time=0,scale=256:144:force_original_aspect_ratio=decrease,pad=256:144:(ow-iw)/2:(oh-ih)/2,tpad=stop_mode=clone:stop=12,tile=4x3:nb_frames=12`,
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-q:v",
      "4",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    );
  } else
    args.push(
      "-vn",
      "-f",
      "s16le",
      "-ac",
      "1",
      "-ar",
      "8000",
      "-acodec",
      "pcm_s16le",
      "pipe:1",
    );
  const rendered = await runMediaProcess("ffmpeg", args, { signal });
  if (!rendered.ok) return rendered;
  if (!rendered.value.length)
    return {
      ok: false,
      error: {
        code: "IO_ERROR",
        message: "The requested source range produced no review data",
      },
    };
  if (request.kind === "contact-sheet")
    return {
      ok: true,
      value: {
        ...metadata,
        mimeType: "image/jpeg",
        data: rendered.value.toString("base64"),
        columns: 4,
        rows: 3,
        timesUs: Array.from(
          { length: 12 },
          (_, index) => request.startUs + Math.floor((index * durationUs) / 12),
        ),
      },
    };
  const samplesPerPeak = Math.max(
    1,
    Math.ceil(rendered.value.length / 2 / 512),
  );
  return {
    ok: true,
    value: {
      ...metadata,
      sampleRate: 8000,
      samplesPerPeak,
      peaks: computePeaks(rendered.value, samplesPerPeak),
    },
  };
}

export async function sourceReview(
  asset: Asset,
  request: SourceReviewRequest,
  signal: AbortSignal,
): Promise<Result<SourceReview>> {
  if (
    !asset.probe ||
    request.endUs > asset.probe.duration_us ||
    (request.kind === "contact-sheet" && asset.kind !== "Video") ||
    (request.kind === "waveform" && asset.probe.audio_channels < 1)
  )
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message:
          "Choose an available source range with the requested video or audio stream",
      },
    };
  try {
    const fingerprint = await mediaCacheId(asset.path, asset.id);
    if (signal.aborted)
      return {
        ok: false,
        error: { code: "CANCELLED", message: "Source review cancelled" },
      };
    const key = JSON.stringify([
      fingerprint,
      request.kind,
      request.startUs,
      request.endUs,
    ]);
    const cached = cachedSourceReview(key);
    if (cached) return { ok: true, value: cached };
    const rendered = await renderSourceReview(asset, request, signal);
    if (!rendered.ok) return rendered;
    if ((await mediaCacheId(asset.path, asset.id)) !== fingerprint)
      return {
        ok: false,
        error: {
          code: "CONFLICT",
          message: "The source changed while preparing review data",
        },
      };
    retainSourceReview(key, rendered.value);
    return rendered;
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "IO_ERROR",
        message:
          error instanceof Error
            ? error.message
            : "Source review could not read the media",
      },
    };
  }
}
