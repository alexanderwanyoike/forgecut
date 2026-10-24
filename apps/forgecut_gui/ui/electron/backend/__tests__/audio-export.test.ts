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
function samples(path: string) {
  return ffmpeg([
    "-i",
    path,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-f",
    "f32le",
    "pipe:1",
  ]);
}
function rms(pcm: Buffer, seconds: number) {
  const start = Math.round(seconds * 48000);
  let energy = 0;
  for (let sample = start; sample < start + 240; sample += 1)
    energy += pcm.readFloatLE(sample * 4) ** 2;
  return Math.sqrt(energy / 240);
}
it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "exports the same editable source gain, fades and mute as resolved preview frames",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-audio-export-"));
    try {
      const source = join(directory, "source.mkv");
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=24x24:r=20:d=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=2",
        "-c:v",
        "ffv1",
        "-threads",
        "1",
        "-c:a",
        "pcm_s16le",
        source,
      ]);
      const state = new AppState();
      const service = new EditingService(state);
      await service.execute("update_project", {
        settings: { width: 24, height: 24, fps: 20 },
      });
      await service.execute("init_default_tracks");
      await service.execute("import_assets", { paths: [source] });
      await service.execute("add_clip_to_timeline", {
        assetId: state.project.assets[0].id,
        trackId: state.project.timeline.tracks[0].id,
        timelineStartUs: 0,
      });
      const item = state.project.timeline.tracks[0].items[0];
      if (!("VideoClip" in item)) throw new Error("Invalid source fixture");
      const itemId = item.VideoClip.id;
      const baseline = join(directory, "baseline.mp4");
      expect(await exportProject(state.project, baseline)).toMatchObject({
        ok: true,
      });
      const reference = samples(baseline);
      expect(
        await service.execute("update_item", {
          itemId,
          patch: {
            kind: "VideoClip",
            changes: { volume: 0.5, fade_in_us: 1000000, fade_out_us: 1000000 },
          },
        }),
      ).toMatchObject({ ok: true });
      const faded = join(directory, "faded.mp4");
      expect(await exportProject(state.project, faded)).toMatchObject({
        ok: true,
      });
      const actual = samples(faded);
      for (const timeUs of [250000, 750000, 1250000, 1750000]) {
        const frame = await service.execute("get_sequence_frame", {
          playheadUs: timeUs,
        });
        if (!frame.ok) throw new Error(frame.error.message);
        const value = frame.value as { layers: { audioGain: number }[] };
        expect(
          rms(actual, timeUs / 1000000) / rms(reference, timeUs / 1000000),
        ).toBeCloseTo(value.layers[0].audioGain, 1);
      }
      await service.execute("update_item", {
        itemId,
        patch: { kind: "VideoClip", changes: { muted: true } },
      });
      const muted = join(directory, "muted.mp4");
      expect(await exportProject(state.project, muted)).toMatchObject({
        ok: true,
      });
      expect(rms(samples(muted), 1)).toBeLessThan(0.00001);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
