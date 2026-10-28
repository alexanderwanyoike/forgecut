/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { graphicRenderInputs } from "../graphic-render-inputs";
import { renderGraphic } from "../graphic-render";

it.skipIf(process.env.FORGECUT_GRAPHICS_TEST !== "1")(
  "renders a whole card as a scaled transparent WebM for playback",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-graphic-webm-"));
    try {
      const state = new AppState();
      const service = new EditingService(state);
      await service.execute("update_project", {
        settings: { width: 1920, height: 1080, fps: 10 },
      });
      const added = await service.execute("add_graphic_item", {
        templateId: "title-card",
        trackId: "graphics",
        timelineStartUs: 0,
        durationUs: 1000000,
        props: {
          title: "",
          background_color: "#ff0000",
          background_opacity: 0.5,
          entrance_frames: 0,
        },
      });
      if (!added.ok) throw new Error(added.error.message);
      const [graphic] = state.project.timeline.tracks
        .flatMap((track) => track.items)
        .flatMap((item) => ("RemotionGraphic" in item ? [item] : []));
      const inputs = await graphicRenderInputs(
        state.project,
        graphic.RemotionGraphic,
        state.project.settings,
      );
      if (!inputs.ok) throw new Error(inputs.error.message);
      const output = join(directory, "card.webm");
      const rendered = await renderGraphic(
        {
          ...inputs.value.job,
          format: "webm",
          output,
          renderFrames: inputs.value.job.duration,
        },
        directory,
      );
      expect(rendered).toEqual({ ok: true, value: output });
      const frames = spawnSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-c:v",
          "libvpx-vp9",
          "-i",
          output,
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgba",
          "pipe:1",
        ],
        { maxBuffer: 64 * 1024 * 1024 },
      );
      expect(frames.status, frames.stderr.toString()).toBe(0);
      const frameBytes = 960 * 540 * 4;
      expect(frames.stdout.length).toBe(10 * frameBytes);
      const [red, green, , alpha] = frames.stdout.subarray(
        5 * frameBytes,
        5 * frameBytes + 4,
      );
      expect(red).toBeGreaterThan(200);
      expect(green).toBeLessThan(40);
      expect(alpha).toBeGreaterThan(100);
      expect(alpha).toBeLessThan(156);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  120000,
);
