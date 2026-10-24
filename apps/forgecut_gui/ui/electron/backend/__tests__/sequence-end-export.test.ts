/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { exportProject } from "../exporter";

it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "exports exactly the explicit end and ignores sources beyond it",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-end-export-"));
    try {
      const state = new AppState();
      state.executeProjectChange((project) => {
        project.settings = {
          width: 32,
          height: 24,
          fps: 10,
          sample_rate: 48000,
        };
        project.assets.push({
          id: "future",
          kind: "Video",
          name: "Future",
          path: join(directory, "missing.mp4"),
          probe: null,
        });
        project.timeline.tracks.push({
          id: "video",
          kind: "Video",
          items: [
            {
              VideoClip: {
                id: "future-clip",
                track_id: "video",
                asset_id: "future",
                timeline_start_us: 2000000,
                source_in_us: 0,
                source_out_us: 1000000,
              },
            },
          ],
        });
      });
      const service = new EditingService(state);
      await service.execute("add_text_overlay", {
        trackId: "title",
        timelineStartUs: 0,
        durationUs: 2000000,
        text: "X",
        fontSize: 14,
        color: "#ffffff",
        x: 0,
        y: 0,
      });
      await service.execute("set_sequence_end", { endUs: 1000000 });
      const short = join(directory, "short.mp4");
      expect(await exportProject(state.project, short)).toMatchObject({
        ok: true,
      });
      const frames = (path: string) => {
        const run = spawnSync("ffmpeg", [
          "-hide_banner",
          "-loglevel",
          "error",
          "-threads",
          "1",
          "-i",
          path,
          "-an",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ]);
        if (run.status !== 0) throw new Error(run.stderr.toString());
        return run.stdout;
      };
      expect(frames(short).length).toBe(10 * 32 * 24 * 3);
      await service.execute("delete_clip", { itemId: "future-clip" });
      await service.execute("set_sequence_end", { endUs: 4000000 });
      const long = join(directory, "long.mp4");
      expect(await exportProject(state.project, long)).toMatchObject({
        ok: true,
      });
      const pixels = frames(long);
      expect(pixels.length).toBe(40 * 32 * 24 * 3);
      expect(
        Math.max(...pixels.subarray(35 * 32 * 24 * 3, 36 * 32 * 24 * 3)),
      ).toBeLessThan(5);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
