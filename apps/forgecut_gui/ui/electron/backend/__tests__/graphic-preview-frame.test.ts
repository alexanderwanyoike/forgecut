/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { componentVersion } from "../graphic-component";
const available =
  process.env.FORGECUT_GRAPHICS_TEST === "1" &&
  process.platform === "linux" &&
  spawnSync("systemctl", ["--user", "is-active", "--quiet", "default.target"])
    .status === 0;
function source(state: AppState, code: string) {
  state.executeProjectChange((project) => {
    const component = project.components![0];
    component.source.files[component.source.entry] = code;
    component.version = componentVersion(component);
    const item = project.timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
    item.RemotionGraphic.component_version = component.version;
  });
}
it.skipIf(!available)(
  "previews custom source at exact frames and reuses the isolated renderer for live property changes",
  async () => {
    const state = new AppState();
    const service = new EditingService(state);
    try {
      await service.execute("update_project", {
        settings: { width: 64, height: 36, fps: 10 },
      });
      await service.execute("add_graphic_item", {
        templateId: "title-card",
        trackId: "graphics",
        timelineStartUs: 0,
        durationUs: 1000000,
        props: { title: "", color: "#00ff00" },
      });
      source(
        state,
        'import {useCurrentFrame} from "remotion"; export default function Card({values}:{values:Record<string,string|number|boolean|null>}){return <div style={{position:"absolute",inset:0,backgroundColor:useCurrentFrame()<5?String(values.color):"#0000ff"}}/>}',
      );
      const item = state.project.timeline.tracks[0].items[0];
      if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
      const before = state.snapshot();
      const first = await service.execute("get_graphic_preview", {
        itemId: item.RemotionGraphic.id,
        frame: 0,
        props: item.RemotionGraphic.props,
      });
      expect(first, JSON.stringify(first)).toMatchObject({
        ok: true,
        value: {
          mimeType: "image/png",
          width: 64,
          height: 36,
          data: expect.any(String),
        },
      });
      const pixels = (result: typeof first) => {
        if (!result.ok) throw new Error(result.error.message);
        const value = result.value as { data: string };
        const decoded = spawnSync(
          "ffmpeg",
          [
            "-v",
            "error",
            "-threads",
            "1",
            "-i",
            "pipe:0",
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-threads",
            "1",
            "pipe:1",
          ],
          { input: Buffer.from(value.data, "base64") },
        );
        expect(decoded.status, decoded.stderr.toString()).toBe(0);
        return decoded.stdout;
      };
      expect(pixels(first)[1]).toBeGreaterThan(240);
      const started = Date.now();
      const second = await service.execute("get_graphic_preview", {
        itemId: item.RemotionGraphic.id,
        frame: 5,
        props: item.RemotionGraphic.props,
      });
      expect(second).toMatchObject({ ok: true });
      expect(pixels(second)[2]).toBeGreaterThan(240);
      expect(Date.now() - started).toBeLessThan(1000);
      const changed = await service.execute("get_graphic_preview", {
        itemId: item.RemotionGraphic.id,
        frame: 0,
        props: { ...item.RemotionGraphic.props, color: "#ffff00" },
      });
      expect(pixels(changed)[0]).toBeGreaterThan(240);
      expect(pixels(changed)[1]).toBeGreaterThan(240);
      expect(state.snapshot()).toEqual(before);
      source(
        state,
        'import {useState,useEffect} from "react"; import {delayRender,continueRender} from "remotion"; export default function Card(){const [ready,setReady]=useState(false);const [handle]=useState(()=>delayRender());useEffect(()=>{const timer=setTimeout(()=>{setReady(true);continueRender(handle)},500);return ()=>clearTimeout(timer)},[handle]);return <div style={{position:"absolute",inset:0,backgroundColor:ready?"#00ff00":"#ff0000"}}/>}',
      );
      const delayed = await service.execute("get_graphic_preview", {
        itemId: item.RemotionGraphic.id,
        frame: 0,
      });
      expect(pixels(delayed)[1]).toBeGreaterThan(240);
      source(
        state,
        'export default function Card(){throw new Error("Preview draft failure");return null;}',
      );
      const failed = await service.execute("get_graphic_preview", {
        itemId: item.RemotionGraphic.id,
        frame: 0,
      });
      expect(failed).toMatchObject({
        ok: false,
        error: {
          code: "RENDER_FAILED",
          message: expect.stringContaining("Preview draft failure"),
        },
      });
      source(
        state,
        "export default function Card(){while(true){}return null;}",
      );
      const hungAt = Date.now();
      const hung = await service.execute("get_graphic_preview", {
        itemId: item.RemotionGraphic.id,
        frame: 0,
      });
      expect(hung).toMatchObject({ ok: false, error: { code: "TIMEOUT" } });
      expect(Date.now() - hungAt).toBeLessThan(15000);
      source(
        state,
        'export default function Card(){return <div style={{position:"absolute",inset:0,backgroundColor:"#00ff00"}}/>}',
      );
      expect(
        pixels(
          await service.execute("get_graphic_preview", {
            itemId: item.RemotionGraphic.id,
            frame: 0,
          }),
        )[1],
      ).toBeGreaterThan(240);
    } finally {
      await service.closeGraphicsPreview?.();
      await service.jobs.close();
    }
  },
  45000,
);
it.skipIf(!available)(
  "preloads owned fonts for custom draft preview without network access",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-preview-font-"));
    vi.stubEnv("FORGECUT_RESOURCE_DIR", directory);
    const state = new AppState();
    const service = new EditingService(state);
    try {
      await service.execute("update_project", {
        settings: { width: 64, height: 36, fps: 10 },
      });
      await service.execute("add_graphic_item", {
        templateId: "title-card",
        trackId: "graphics",
        timelineStartUs: 0,
        durationUs: 1000000,
        props: { title: "Owned font", entrance_frames: 0 },
      });
      const item = state.project.timeline.tracks[0].items[0];
      if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
      const imported = await service.execute("import_graphic_resource", {
        path: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        kind: "Font",
        licensePath: "/usr/share/doc/fonts-dejavu-core/copyright",
        target: {
          itemId: item.RemotionGraphic.id,
          property: "font",
          sessionId: state.sessionId,
          expectedRevision: state.revision,
        },
      });
      expect(imported).toMatchObject({ ok: true });
      const component = state.project.components![0];
      source(state, component.source.files[component.source.entry] + "\n");
      const before = state.snapshot();
      const rendered = await service.execute("get_graphic_preview", {
        itemId: item.RemotionGraphic.id,
        frame: 0,
      });
      expect(rendered, JSON.stringify(rendered)).toMatchObject({
        ok: true,
        value: { mimeType: "image/png", width: 64, height: 36 },
      });
      expect(state.snapshot()).toEqual(before);
    } finally {
      await service.closeGraphicsPreview();
      await service.jobs.close();
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  },
  20000,
);
