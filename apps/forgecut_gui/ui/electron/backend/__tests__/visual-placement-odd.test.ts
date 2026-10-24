/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
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
it
  .skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)
  .each(["video", "image"])(
  "preserves odd pixel coordinates for a %s layer",
  async (kind) => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-odd-placement-"));
    try {
      const source = join(
        directory,
        kind === "video" ? "white.mkv" : "white.png",
      );
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=c=white:s=8x8:r=10:d=1",
        ...(kind === "video" ? ["-c:v", "ffv1"] : ["-frames:v", "1"]),
        "-threads",
        "1",
        source,
      ]);
      const state = new AppState();
      const service = new EditingService(state);
      await service.execute("update_project", {
        settings: { width: 32, height: 24, fps: 10 },
      });
      await service.execute("init_default_tracks");
      await service.execute("import_assets", { paths: [source] });
      const assetId = state.project.assets[0].id;
      if (kind === "video") {
        await service.execute("add_clip_to_timeline", {
          assetId,
          trackId: state.project.timeline.tracks[0].id,
          timelineStartUs: 0,
        });
        const item = state.project.timeline.tracks[0].items[0];
        if (!("VideoClip" in item)) throw new Error("Invalid video fixture");
        expect(
          await service.execute("update_item", {
            itemId: item.VideoClip.id,
            patch: {
              kind: "VideoClip",
              changes: {
                transform: {
                  x: 5,
                  y: 5,
                  width: 8,
                  height: 8,
                  opacity: 1,
                  fit: "contain",
                },
              },
            },
          }),
        ).toMatchObject({ ok: true });
      } else
        await service.execute("add_image_overlay", {
          assetId,
          timelineStartUs: 0,
          durationUs: 1000000,
          x: 5,
          y: 5,
          width: 8,
          height: 8,
          opacity: 1,
        });
      const output = join(directory, "output.mp4");
      expect(await exportProject(state.project, output)).toMatchObject({
        ok: true,
      });
      const pixels = ffmpeg([
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
      const pixel = (x: number, y: number) => pixels[(y * 32 + x) * 3];
      expect(pixel(4, 4)).toBeLessThan(25);
      expect(pixel(5, 5)).toBeGreaterThan(220);
      expect(pixel(12, 12)).toBeGreaterThan(220);
      expect(pixel(13, 13)).toBeLessThan(25);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
