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
  sourceUs: { in?: number; out?: number } = {},
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
    ...(sourceUs.in === undefined ? {} : { sourceInUs: sourceUs.in }),
    ...(sourceUs.out === undefined ? {} : { sourceOutUs: sourceUs.out }),
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
      "color=c=0x20c040:s=32x32:r=10:d=2",
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
        expect(Math.abs(channel - composited[index])).toBeLessThanOrEqual(8),
      );
  },
);

// Matroska stores millisecond timestamps; QuickTime keeps NTSC frames exact at 1/30000.
const film = {
  rate: "24",
  file: "counter.mkv",
  seconds: 3,
  ticksPerSecond: 1000,
  ticks: (frame: number) => Math.round((frame * 1000) / 24),
};
const ntsc = {
  rate: "30000/1001",
  file: "counter.mov",
  seconds: 22,
  ticksPerSecond: 30000,
  ticks: (frame: number) => frame * 1001,
};

it.skipIf(!available).each([
  {
    name: "24 fps footage near its start",
    source: film,
    sourceUs: { in: 0, out: 3000000 },
    titleStartUs: 133333,
  },
  {
    name: "24 fps footage after a seek, off the source frame grid",
    source: film,
    sourceUs: { in: 66667, out: 3000000 },
    titleStartUs: 2500000,
  },
  {
    name: "29.97 fps footage well after a seek",
    source: ntsc,
    sourceUs: { in: 0, out: 21500000 },
    titleStartUs: 20000000,
  },
])(
  "keeps continuous frame selection when a span enters $name",
  async ({ source, sourceUs, titleStartUs }) => {
    const path = join(directory, source.file);
    // Frame k shows k mod 64 on the left and k div 64 on the right, in luma steps of 3.
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `nullsrc=s=32x32:r=${source.rate}:d=${source.seconds},geq=lum='16+3*if(lt(X,16),mod(N,64),floor(N/64))':cb=128:cr=128`,
      "-c:v",
      "ffv1",
      path,
    ]);
    const output = await exportWithMidClipTitle(
      path,
      30,
      { start: titleStartUs, duration: 200000 },
      sourceUs,
    );
    const level = (frame: Buffer, column: number) =>
      Math.round((frame[16 * 32 + column] - 16) / 3);
    const shown = frames(output, "yuv420p", 32 * 48).map(
      (frame) => level(frame, 4) + 64 * level(frame, 24),
    );
    // Continuous decoding anchors on the first frame at or after the in-point, and
    // FFmpeg's fps filter shows the latest frame whose timestamp rounds to the slot.
    let first = 0;
    while (source.ticks(first) * 1e6 < sourceUs.in * source.ticksPerSecond)
      first += 1;
    const slotOf = (frame: number) =>
      Math.round(
        ((source.ticks(frame) - source.ticks(first)) * 30) /
          source.ticksPerSecond,
      );
    const expected = shown.map((_, slot) => {
      let frame = first;
      while (slotOf(frame + 1) <= slot) frame += 1;
      return frame;
    });
    expect(shown).toEqual(expected);
  },
);
