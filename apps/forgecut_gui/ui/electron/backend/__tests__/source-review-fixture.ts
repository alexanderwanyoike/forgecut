import { spawnSync } from "node:child_process";

export function generateReviewSource(path: string): void {
  const generated = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=64x36:rate=10",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=8000",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    path,
  ]);
  if (generated.status !== 0)
    throw new Error(
      generated.stderr?.toString() ?? "Could not generate review source",
    );
}
