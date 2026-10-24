/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { exportProject } from "../exporter";

it.skipIf(process.env.FORGECUT_GRAPHICS_TEST !== "1")(
  "renders a pinned Remotion card without footage at its exact timeline frames",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-graphic-export-"));
    try {
      const state = new AppState();
      const service = new EditingService(state);
      await service.execute("update_project", {
        settings: { width: 64, height: 36, fps: 10 },
      });
      const added = await service.execute("add_graphic_item", {
        templateId: "title-card",
        trackId: "graphics",
        timelineStartUs: 1000000,
        durationUs: 1000000,
        props: { title: "", background_color: "#ff0000", entrance_frames: 0 },
      });
      if (!added.ok) throw new Error(added.error.message);
      const output = join(directory, "output.mp4");
      const result = await exportProject(state.project, output);
      expect(result).toMatchObject({ ok: true });
      const frames = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-threads",
        "1",
        "-i",
        output,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-threads",
        "1",
        "pipe:1",
      ]);
      expect(frames.status, frames.stderr.toString()).toBe(0);
      expect(frames.stdout.length).toBe(20 * 64 * 36 * 3);
      expect([...frames.stdout.subarray(0, 3)]).toEqual([0, 0, 0]);
      const red = [
        ...frames.stdout.subarray(10 * 64 * 36 * 3, 10 * 64 * 36 * 3 + 3),
      ];
      expect(red[0]).toBeGreaterThan(240);
      expect(red[1]).toBeLessThan(10);
      const project = structuredClone(state.project);
      project.components![0].source.files["main.tsx"] +=
        "\n// unsupported source";
      await writeFile(output, "previous export");
      expect(await exportProject(project, output)).toMatchObject({ ok: false });
      expect(await readFile(output, "utf8")).toBe("previous export");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  120000,
);
