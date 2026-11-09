/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { exportProject } from "../exporter";

function ffmpeg(args: string[]) {
  const run = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-threads", "1", ...args],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0) throw new Error(run.stderr.toString());
  return run.stdout;
}

const available = spawnSync("ffmpeg", ["-version"]).status === 0;
let directory: string;
let state: AppState;
let service: EditingService;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "forgecut-span-consistency-"));
  state = new AppState();
  service = new EditingService(state);
});

afterEach(async () => {
  await service.jobs.close();
  await service.closePreviews();
  await rm(directory, { recursive: true, force: true });
});

/** Puts the source on the primary track with an off-canvas title over `titleUs`, forcing a composited span mid-clip. */
async function exportWithMidClipTitle(
  source: string,
  fps: number,
  titleUs: { start: number; duration: number },
) {
  await service.execute("update_project", {
    settings: { width: 32, height: 32, fps },
  });
  await service.execute("init_default_tracks");
  await service.execute("import_assets", { paths: [source] });
  await service.execute("add_clip_to_timeline", {
    assetId: state.project.assets[0].id,
    trackId: state.project.timeline.tracks[0].id,
    timelineStartUs: 0,
  });
  await service.execute("add_text_overlay", {
    trackId: "title",
    timelineStartUs: titleUs.start,
    durationUs: titleUs.duration,
    text: "x",
    fontSize: 8,
    color: "#ffffff",
    x: 200,
    y: 200,
  });
  const output = join(directory, "export.mp4");
  expect(await exportProject(state.project, output)).toMatchObject({
    ok: true,
  });
  return output;
}

function frames(path: string, pixelFormat: string, bytesPerFrame: number) {
  const raw = ffmpeg([
    "-i",
    path,
    "-an",
    "-f",
    "rawvideo",
    "-pix_fmt",
    pixelFormat,
    "pipe:1",
  ]);
  return Array.from({ length: raw.length / bytesPerFrame }, (_, index) =>
    raw.subarray(index * bytesPerFrame, (index + 1) * bytesPerFrame),
  );
}

it.skipIf(!available)(
  "converts tagged full-range footage the same way in plain and composited spans",
  async () => {
    const source = join(directory, "tagged.mp4");
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=c=0x3080c0:s=32x32:r=10:d=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuvj420p",
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-color_range",
      "pc",
      source,
    ]);
    const output = await exportWithMidClipTitle(source, 10, {
      start: 500000,
      duration: 500000,
    });
    const rgb = frames(output, "rgb24", 32 * 32 * 3).map((frame) =>
      Array.from(frame.subarray(16 * 32 * 3 + 16 * 3, 16 * 32 * 3 + 19 * 3)),
    );
    expect(rgb).toHaveLength(20);
    const composited = rgb[7];
    for (const plain of [rgb[2], rgb[15]])
      plain.forEach((channel, index) =>
        expect(Math.abs(channel - composited[index])).toBeLessThanOrEqual(3),
      );
  },
);

it.skipIf(!available)(
  "keeps continuous frame selection when a span starts mid-clip in slower footage",
  async () => {
    const source = join(directory, "counter.mkv");
    // Each 24 fps source frame k has luma 16 + 4k, so the export reveals which frame it shows.
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "nullsrc=s=32x32:r=24:d=2,geq=lum='16+4*N':cb=128:cr=128",
      "-c:v",
      "ffv1",
      source,
    ]);
    const output = await exportWithMidClipTitle(source, 30, {
      start: 133333,
      duration: 300000,
    });
    const shown = frames(output, "yuv420p", 32 * 48).map((frame) =>
      Math.round((frame[16 * 32 + 16] - 16) / 4),
    );
    // Matroska stores millisecond timestamps, and FFmpeg's fps filter shows the latest
    // source frame whose timestamp rounds to the output slot.
    const slotOf = (frame: number) =>
      Math.round((Math.round((frame * 1000) / 24) * 30) / 1000);
    const expected = Array.from({ length: 60 }, (_, slot) => {
      let frame = 0;
      while (slotOf(frame + 1) <= slot) frame += 1;
      return frame;
    });
    expect(shown).toEqual(expected);
  },
);
