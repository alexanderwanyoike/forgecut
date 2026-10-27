/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { exportProject } from "../exporter";
import type { JobSnapshot } from "../../shared/jobs";

function ffmpeg(args: string[]) {
  const result = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-threads",
    "1",
    "-filter_threads",
    "1",
    ...args,
  ]);
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
}

it.skipIf(
  ["ffmpeg", "ffprobe"].some(
    (tool) => spawnSync(tool, ["-version"]).status !== 0,
  ),
)(
  "exports a frame-aligned review range without restarting its picture or audio fade clock",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-review-range-"));
    const state = new AppState();
    const service = new EditingService(state);
    try {
      const source = join(directory, "source.mkv");
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=64x36:r=10:d=1",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=64x36:r=10:d=1",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=2",
        "-filter_complex",
        "[0:v][1:v]concat=n=2:v=1:a=0[v]",
        "-map",
        "[v]",
        "-map",
        "2:a",
        "-c:v",
        "ffv1",
        "-threads",
        "1",
        "-c:a",
        "pcm_s16le",
        source,
      ]);
      expect(
        await service.execute("update_project", {
          settings: { width: 64, height: 36, fps: 10 },
        }),
      ).toMatchObject({ ok: true });
      await service.execute("init_default_tracks");
      expect(
        await service.execute("import_assets", { paths: [source] }),
      ).toMatchObject({ ok: true });
      expect(
        await service.execute("add_clip_to_timeline", {
          assetId: state.project.assets[0].id,
          trackId: state.project.timeline.tracks[0].id,
          timelineStartUs: 0,
        }),
      ).toMatchObject({ ok: true });
      const item = state.project.timeline.tracks[0].items[0];
      if (!("VideoClip" in item)) throw new Error("Missing review clip");
      expect(
        await service.execute("update_item", {
          itemId: item.VideoClip.id,
          patch: { kind: "VideoClip", changes: { fade_in_us: 2000000 } },
        }),
      ).toMatchObject({ ok: true });
      const before = state.snapshot();
      const outputPath = join(directory, "review.mp4");
      const started = await service.execute("export_project", {
        outputPath,
        range: { startUs: 1250000, endUs: 1850000 },
      });
      expect(started).toMatchObject({ ok: true, value: { kind: "export" } });
      if (!started.ok) throw new Error(started.error.message);
      let job = started.value as JobSnapshot;
      for (
        let attempt = 0;
        attempt < 300 &&
        !["completed", "failed", "cancelled"].includes(job.status);
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const response = service.jobs.read(job.id, state.sessionId);
        if (!response.ok) throw new Error(response.error.message);
        job = response.value;
      }
      expect(job).toMatchObject({ status: "completed", result: { ok: true } });
      const frames = spawnSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-count_frames",
          "-show_entries",
          "stream=nb_read_frames",
          "-of",
          "csv=p=0",
          outputPath,
        ],
        { encoding: "utf8" },
      );
      expect(frames.status, frames.stderr).toBe(0);
      expect(Number(frames.stdout.trim())).toBe(6);
      const pixels = ffmpeg([
        "-i",
        outputPath,
        "-an",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ]);
      expect(pixels[0]).toBeLessThan(40);
      expect(pixels[2]).toBeGreaterThan(200);
      const pcm = ffmpeg([
        "-i",
        outputPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-f",
        "s16le",
        "pipe:1",
      ]);
      const samples = Array.from(
        { length: Math.min(pcm.length / 2, 4800) },
        (_, index) => pcm.readInt16LE(index * 2) / 32768,
      );
      const rms = Math.sqrt(
        samples.reduce((sum, sample) => sum + sample * sample, 0) /
          samples.length,
      );
      expect(rms).toBeGreaterThan(0.03);
      expect(state.snapshot()).toEqual(before);
    } finally {
      await service.jobs.close();
      await service.closeGraphicsPreview();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it("preserves existing files and leaves no staging output for invalid or empty review ranges", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-invalid-review-"));
  const state = new AppState();
  const service = new EditingService(state);
  try {
    await service.execute("update_project", {
      settings: { width: 64, height: 36, fps: 1 },
    });
    await service.execute("add_text_overlay", {
      trackId: "title",
      timelineStartUs: 0,
      durationUs: 2000000,
      text: "Keep this",
      fontSize: 10,
      color: "#ffffff",
      x: 0,
      y: 0,
    });
    const path = join(directory, "review.mp4");
    await writeFile(path, "Existing review");
    const before = state.snapshot();
    for (const range of [
      { startUs: -1, endUs: 200000 },
      { startUs: 0, endUs: 31000000 },
      { startUs: 1000000, endUs: 1000001 },
      { startUs: 2100000, endUs: 2300000 },
      { startUs: 1100000, endUs: 1200000 },
    ]) {
      expect(await exportProject(state.project, path, { range })).toMatchObject(
        { ok: false, error: { code: "INVALID_INPUT" } },
      );
      expect(await readFile(path, "utf8")).toBe("Existing review");
      expect(await readdir(directory)).toEqual(["review.mp4"]);
      expect(state.snapshot()).toEqual(before);
    }
  } finally {
    await service.jobs.close();
    await service.closeGraphicsPreview();
    await rm(directory, { recursive: true, force: true });
  }
});
