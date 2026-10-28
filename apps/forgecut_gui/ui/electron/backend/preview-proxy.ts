import type { Result } from "../shared/result.js";
import { runMediaProcess } from "./media-process.js";

/** Seconds of the source inspected to judge its keyframe spacing. */
export const PROBE_SECONDS = 10;

const MAX_KEYFRAME_GAP_SECONDS = 0.5;

/** Seeking decodes forward from the previous keyframe, so wide spacing makes every cut slow. */
export function needsPreviewProxy(
  keyframes: number[],
  probedSeconds: number,
): boolean {
  if (keyframes.length === 0) return false;
  const gaps =
    keyframes.length === 1
      ? [probedSeconds]
      : keyframes.slice(1).map((time, index) => time - keyframes[index]);
  return Math.max(...gaps) > MAX_KEYFRAME_GAP_SECONDS + 1e-3;
}

export async function probeKeyframes(
  source: string,
  signal?: AbortSignal,
): Promise<Result<number[]>> {
  const probed = await runMediaProcess(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-skip_frame",
      "nokey",
      "-show_entries",
      "frame=pts_time",
      "-of",
      "csv=p=0",
      "-read_intervals",
      `%+${PROBE_SECONDS}`,
      source,
    ],
    { signal, budget: true },
  );
  if (!probed.ok) return probed;
  return {
    ok: true,
    value: probed.value
      .toString()
      .split("\n")
      .map((line) => Number.parseFloat(line))
      .filter(Number.isFinite),
  };
}

export async function encodePreviewProxy(
  source: string,
  output: string,
  signal?: AbortSignal,
): Promise<Result<null>> {
  const encoded = await runMediaProcess(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-i",
      source,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-vf",
      "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-force_key_frames",
      "expr:gte(t,n_forced*0.25)",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      output,
    ],
    { signal, budget: true, cpuPercent: 400 },
  );
  return encoded.ok ? { ok: true, value: null } : encoded;
}
