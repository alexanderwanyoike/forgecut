/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

it.skipIf(
  process.env.FORGECUT_GRAPHICS_TEST !== "1" || process.platform !== "linux",
)(
  "cancels an active graphics browser before cleaning staging and preserves the destination",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-graphic-cancel-"));
    const controller = new AbortController();
    let running: ReturnType<typeof exportProject> | undefined;
    try {
      const state = new AppState();
      const service = new EditingService(state);
      await service.execute("update_project", {
        settings: { width: 640, height: 360, fps: 30 },
      });
      await service.execute("add_graphic_item", {
        templateId: "title-card",
        trackId: "graphics",
        timelineStartUs: 0,
        durationUs: 60000000,
      });
      const output = join(directory, "output.mp4");
      await writeFile(output, "previous export");
      running = exportProject(state.project, output, {
        signal: controller.signal,
      });
      let worker = "";
      let browser = "";
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const children = spawnSync("pgrep", ["--parent", String(process.pid)], {
          encoding: "utf8",
        })
          .stdout.trim()
          .split(/\s+/);
        for (const pid of children) {
          try {
            if (
              (await readFile(`/proc/${pid}/cmdline`, "utf8")).includes(
                directory,
              )
            ) {
              worker = pid;
              browser =
                spawnSync("pgrep", ["--parent", pid], { encoding: "utf8" })
                  .stdout.trim()
                  .split(/\s+/)[0] ?? "";
            }
          } catch {}
        }
        if (browser) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(worker).not.toBe("");
      expect(browser).not.toBe("");
      controller.abort();
      expect(await running).toMatchObject({
        ok: false,
        error: { code: "CANCELLED" },
      });
      await expect(readFile(`/proc/${worker}/cmdline`)).rejects.toThrow();
      try {
        expect(
          (await readFile(`/proc/${browser}/stat`, "utf8")).split(" ")[2],
        ).toBe("Z");
      } catch (failure) {
        if (!(
          failure instanceof Error &&
          "code" in failure &&
          failure.code === "ENOENT"
        ))
          throw failure;
      }
      expect(await readFile(output, "utf8")).toBe("previous export");
      expect(await readdir(directory)).toEqual(["output.mp4"]);
    } finally {
      controller.abort();
      await running;
      await rm(directory, { recursive: true, force: true });
    }
  },
  30000,
);
