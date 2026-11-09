/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
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

function source(path: string, color: string, size = "64x36") {
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=${size}:r=10:d=2`,
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=2",
    "-c:v",
    "ffv1",
    "-c:a",
    "pcm_s16le",
    path,
  ]);
}

it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "joins back-to-back cuts with exact frames and continuous sound",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-span-join-"));
    const state = new AppState();
    const service = new EditingService(state);
    try {
      const red = join(directory, "red.mkv");
      const blue = join(directory, "blue.mkv");
      source(red, "red");
      source(blue, "blue");
      await service.execute("update_project", {
        settings: { width: 64, height: 36, fps: 10 },
      });
      await service.execute("init_default_tracks");
      await service.execute("import_assets", { paths: [red, blue] });
      const trackId = state.project.timeline.tracks[0].id;
      for (const [index, timelineStartUs] of [0, 1500000].entries())
        expect(
          await service.execute("add_clip_to_timeline", {
            assetId: state.project.assets[index].id,
            trackId,
            timelineStartUs,
            sourceInUs: 0,
            sourceOutUs: 1500000,
          }),
        ).toMatchObject({ ok: true });
      const output = join(directory, "joined.mp4");
      expect(await exportProject(state.project, output)).toMatchObject({
        ok: true,
      });

      const pixels = ffmpeg([
        "-i",
        output,
        "-an",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ]);
      const stride = 64 * 36 * 3;
      expect(pixels.length / stride).toBe(30);
      const reds = Array.from(
        { length: 30 },
        (_, frame) => pixels[frame * stride + 32 * 3] > 150,
      );
      expect(reds).toEqual(
        Array.from({ length: 30 }, (_, frame) => frame < 15),
      );

      const pcm = ffmpeg([
        "-i",
        output,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-f",
        "f32le",
        "pipe:1",
      ]);
      const window = 480;
      const quietWindows = [];
      for (let start = 0; start + window <= 2.9 * 48000; start += window) {
        let energy = 0;
        for (let sample = start; sample < start + window; sample += 1)
          energy += pcm.readFloatLE(sample * 4) ** 2;
        if (Math.sqrt(energy / window) < 0.05) quietWindows.push(start);
      }
      expect(quietWindows).toEqual([]);
    } finally {
      await service.jobs.close();
      await service.closePreviews();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "centres a narrower cut at an odd offset, as the composited path does",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-span-centre-"));
    const state = new AppState();
    const service = new EditingService(state);
    try {
      const narrow = join(directory, "narrow.mkv");
      source(narrow, "white", "62x36");
      await service.execute("update_project", {
        settings: { width: 64, height: 36, fps: 10 },
      });
      await service.execute("init_default_tracks");
      await service.execute("import_assets", { paths: [narrow] });
      await service.execute("add_clip_to_timeline", {
        assetId: state.project.assets[0].id,
        trackId: state.project.timeline.tracks[0].id,
        timelineStartUs: 0,
      });
      const output = join(directory, "centred.mp4");
      expect(await exportProject(state.project, output)).toMatchObject({
        ok: true,
      });
      const luma = ffmpeg([
        "-i",
        output,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "pipe:1",
      ]);
      const row = 18 * 64;
      expect([0, 1, 62, 63].map((column) => luma[row + column] > 128)).toEqual([
        false,
        true,
        true,
        false,
      ]);
    } finally {
      await service.jobs.close();
      await service.closePreviews();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
