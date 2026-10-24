/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { exportProject } from "../exporter";

function ffmpeg(args: string[]) {
  const run = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-threads",
    "1",
    "-filter_threads",
    "1",
    ...args,
  ]);
  if (run.status !== 0) throw new Error(run.stderr.toString());
  return run.stdout;
}

it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "renders leading gaps, silent cuts, an independent music bed and a title-only ending at their timeline positions",
  async () => {
    const dir = await mkdtemp(join(process.cwd(), ".forgecut-render-test-"));
    try {
      const source = join(dir, "source.mkv");
      const music = join(dir, "music.wav");
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=64x36:r=10:d=2",
        "-c:v",
        "ffv1",
        "-threads",
        "1",
        source,
      ]);
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=4",
        music,
      ]);
      const state = new AppState();
      const editing = new EditingService(state);
      expect(
        (
          await editing.execute("update_project", {
            settings: { width: 64, height: 36, fps: 10 },
          })
        ).ok,
      ).toBe(true);
      await editing.execute("init_default_tracks");
      expect(
        (
          await editing.execute("import_assets", {
            paths: [relative(process.cwd(), source), music],
          })
        ).ok,
      ).toBe(true);
      const [video, audio] = state.project.assets;
      const [picture, sound] = state.project.timeline.tracks;
      for (const start of [1000000, 2000000])
        expect(
          (
            await editing.execute("add_clip_to_timeline", {
              assetId: video.id,
              trackId: picture.id,
              timelineStartUs: start,
              sourceInUs: 0,
              sourceOutUs: 1000000,
            })
          ).ok,
        ).toBe(true);
      await editing.execute("add_clip_to_timeline", {
        assetId: audio.id,
        trackId: sound.id,
        timelineStartUs: 0,
      });
      await editing.execute("add_text_overlay", {
        trackId: "titles",
        timelineStartUs: 3000000,
        durationUs: 1000000,
        text: "End",
        fontSize: 14,
        color: "#ffffff",
        x: 3,
        y: 3,
      });
      const output = join(dir, "output.mp4");
      await exportProject(state.project, output);
      const probe = spawnSync("ffprobe", [
        "-v",
        "error",
        "-count_frames",
        "-show_streams",
        "-of",
        "json",
        output,
      ]);
      const streams = JSON.parse(probe.stdout.toString()).streams;
      expect(
        Number(
          streams.find(
            (stream: { codec_type: string }) => stream.codec_type === "video",
          ).nb_read_frames,
        ),
      ).toBe(40);
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
      expect([...pixels.subarray(5 * stride, 5 * stride + 3)]).toEqual([
        0, 0, 0,
      ]);
      expect(pixels[15 * stride]).toBeGreaterThan(200);
      expect(pixels[25 * stride]).toBeGreaterThan(200);
      expect(pixels[35 * stride]).toBeLessThan(10);
      expect(
        Math.max(...pixels.subarray(35 * stride, 36 * stride)),
      ).toBeGreaterThan(150);
      const pcm = ffmpeg([
        "-i",
        output,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-f",
        "s16le",
        "pipe:1",
      ]);
      for (const second of [0.5, 1.5, 2.5, 3.5]) {
        const sample = Math.floor(second * 48000);
        let energy = 0;
        for (let offset = 0; offset < 1000; offset += 1)
          energy += Math.abs(pcm.readInt16LE((sample + offset) * 2));
        expect(energy / 1000).toBeGreaterThan(500);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "renders an image and literal text without hidden video underneath",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgecut-card-"));
    try {
      const path = join(dir, "image.png");
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=c=white:s=8x8",
        "-frames:v",
        "1",
        "-threads",
        "1",
        path,
      ]);
      const state = new AppState();
      const editing = new EditingService(state);
      await editing.execute("update_project", {
        settings: { width: 64, height: 36, fps: 10 },
      });
      await editing.execute("import_assets", { paths: [path] });
      await editing.execute("add_image_overlay", {
        assetId: state.project.assets[0].id,
        timelineStartUs: 0,
        durationUs: 1000000,
        x: 0,
        y: 0,
        width: 8,
        height: 8,
        opacity: 0.5,
      });
      await editing.execute("add_text_overlay", {
        trackId: "titles",
        timelineStartUs: 0,
        durationUs: 1000000,
        text: "A:B 'C' 50% \\ \n next",
        fontSize: 10,
        color: "#ffffff",
        x: 0,
        y: 20,
      });
      const output = join(dir, "card.mp4");
      await exportProject(state.project, output);
      const pixels = ffmpeg([
        "-ss",
        "0.5",
        "-i",
        output,
        "-frames:v",
        "1",
        "-an",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ]);
      expect(pixels[0]).toBeGreaterThan(100);
      expect(pixels[0]).toBeLessThan(150);
      expect(pixels[30]).toBeLessThan(10);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "uses exact frame intervals after microsecond boundary rounding",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgecut-frame-boundaries-"));
    try {
      const state = new AppState();
      const editing = new EditingService(state);
      await editing.execute("update_project", {
        settings: { width: 64, height: 36, fps: 30 },
      });
      await editing.execute("add_text_overlay", {
        trackId: "background",
        timelineStartUs: 0,
        durationUs: 333333,
        text: "Background",
        fontSize: 14,
        color: "#000000",
        x: 0,
        y: 0,
      });
      await editing.execute("add_text_overlay", {
        trackId: "titles",
        timelineStartUs: 66667,
        durationUs: 100000,
        text: "X",
        fontSize: 14,
        color: "#ffffff",
        x: 0,
        y: 0,
      });
      const output = join(dir, "frames.mp4");
      await exportProject(state.project, output);
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
      const active = Array.from(
        { length: 10 },
        (_, frame) =>
          Math.max(...pixels.subarray(frame * stride, (frame + 1) * stride)) >
          150,
      );
      expect(active).toEqual([
        false,
        false,
        true,
        true,
        true,
        false,
        false,
        false,
        false,
        false,
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
