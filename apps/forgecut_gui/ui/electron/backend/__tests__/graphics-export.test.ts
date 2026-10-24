/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { exportProject } from "../exporter";

afterEach(() => vi.unstubAllEnvs());

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
                spawnSync(
                  "pgrep",
                  [
                    "-f",
                    join(
                      process.cwd(),
                      "electron/dist/graphic-runtime/browser/",
                    ),
                  ],
                  { encoding: "utf8" },
                )
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

it.skipIf(process.env.FORGECUT_GRAPHICS_TEST !== "1")(
  "renders owned artwork through Remotion with its exact pixel content",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-artwork-render-"));
    try {
      vi.stubEnv("FORGECUT_RESOURCE_DIR", join(directory, "cache"));
      const path = join(directory, "green.png");
      const generated = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=lime:s=64x36",
        "-frames:v",
        "1",
        "-threads",
        "1",
        path,
      ]);
      expect(generated.status, generated.stderr.toString()).toBe(0);
      const state = new AppState();
      const service = new EditingService(state);
      await service.execute("update_project", {
        settings: { width: 64, height: 36, fps: 10 },
      });
      await service.execute("add_graphic_item", {
        templateId: "title-card",
        trackId: "graphics",
        timelineStartUs: 0,
        durationUs: 1000000,
        props: { title: "", entrance_frames: 0, background_opacity: 0 },
      });
      const item = state.project.timeline.tracks[0].items[0];
      if (!("RemotionGraphic" in item)) throw new Error("Invalid fixture");
      expect(
        await service.execute("import_graphic_resource", {
          path,
          kind: "Image",
          license: { identifier: "test-only", text: "Generated image" },
          target: {
            itemId: item.RemotionGraphic.id,
            property: "image",
            sessionId: state.sessionId,
            expectedRevision: state.revision,
          },
        }),
      ).toMatchObject({ ok: true });
      const output = join(directory, "result.mp4");
      expect(await exportProject(state.project, output)).toMatchObject({
        ok: true,
      });
      const pixels = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-threads",
        "1",
        "-i",
        output,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-threads",
        "1",
        "pipe:1",
      ]);
      expect(pixels.status, pixels.stderr.toString()).toBe(0);
      expect(pixels.stdout[0]).toBeLessThan(10);
      expect(pixels.stdout[1]).toBeGreaterThan(240);
      expect(pixels.stdout[2]).toBeLessThan(10);
      await service.execute("update_item", {
        itemId: item.RemotionGraphic.id,
        patch: {
          kind: "RemotionGraphic",
          changes: { props: { image_opacity: 0.5 } },
        },
      });
      const half = join(directory, "half.mp4");
      expect(await exportProject(state.project, half)).toMatchObject({
        ok: true,
      });
      const mixed = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-threads",
        "1",
        "-i",
        half,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-threads",
        "1",
        "pipe:1",
      ]);
      expect(mixed.status, mixed.stderr.toString()).toBe(0);
      expect(mixed.stdout[1]).toBeGreaterThan(110);
      expect(mixed.stdout[1]).toBeLessThan(145);
      await service.execute("update_item", {
        itemId: item.RemotionGraphic.id,
        patch: {
          kind: "RemotionGraphic",
          changes: {
            layer_states: {
              "1c1dfd1c-520b-4c83-8a82-b00fdf9b8d90": { hidden: true },
            },
          },
        },
      });
      const hidden = join(directory, "hidden.mp4");
      expect(await exportProject(state.project, hidden)).toMatchObject({
        ok: true,
      });
      const hiddenPixels = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-threads",
        "1",
        "-i",
        hidden,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-threads",
        "1",
        "pipe:1",
      ]);
      expect(hiddenPixels.status, hiddenPixels.stderr.toString()).toBe(0);
      expect([...hiddenPixels.stdout.subarray(0, 3)]).toEqual([0, 0, 0]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  120000,
);
