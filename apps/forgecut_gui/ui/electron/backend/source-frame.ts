import type { Asset } from "./state.js";
import type { Result } from "../shared/result.js";
import { runMediaProcess } from "./media-process.js";

export async function sourceFrame(
  asset: Asset,
  timeUs: number,
  signal: AbortSignal,
): Promise<Result<{ mimeType: "image/jpeg"; data: string }>> {
  if (
    asset.kind === "Audio" ||
    (asset.probe?.duration_us && timeUs >= asset.probe.duration_us)
  )
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Choose a visual asset and a time within its duration.",
      },
    };
  const result = await runMediaProcess(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-threads",
      "1",
      "-filter_threads",
      "1",
      "-ss",
      String(timeUs / 1_000_000),
      "-i",
      asset.path,
      "-frames:v",
      "1",
      "-vf",
      "scale=w='min(640,iw)':h='min(360,ih)':force_original_aspect_ratio=decrease",
      "-threads",
      "1",
      "-q:v",
      "4",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ],
    { signal },
  );
  if (!result.ok) return result;
  if (!result.value.length)
    return {
      ok: false,
      error: {
        code: "IO_ERROR",
        message: "The source returned no frame at that time.",
      },
    };
  return {
    ok: true,
    value: { mimeType: "image/jpeg", data: result.value.toString("base64") },
  };
}
