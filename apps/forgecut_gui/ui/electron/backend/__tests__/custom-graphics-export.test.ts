/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { componentVersion } from "../graphic-component";
import { exportProject } from "../exporter";

const available =
  process.env.FORGECUT_GRAPHICS_TEST === "1" &&
  process.platform === "linux" &&
  spawnSync("systemctl", ["--user", "is-active", "--quiet", "default.target"])
    .status === 0;
async function fixture(source: string) {
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
    props: { title: "", color: "#1ac45c" },
  });
  state.executeProjectChange((project) => {
    const component = project.components![0];
    component.source.files[component.source.entry] = source;
    component.version = componentVersion(component);
    const item = project.timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
    item.RemotionGraphic.component_version = component.version;
  });
  return { state, service };
}
it.skipIf(!available)(
  "renders project source at exact frames while keeping browser code separate from the owner",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-custom-render-"));
    try {
      const { state, service } =
        await fixture(`import {useCurrentFrame} from "remotion";
    export default function Card({values}:{values:Record<string,string|number|boolean|null>}){
      const frame=useCurrentFrame();
      const isolated=typeof Reflect.get(globalThis,"forgecut")==="undefined" && typeof Reflect.get(globalThis,"process")==="undefined";
      return <div style={{position:"absolute",inset:0,backgroundColor:isolated?(frame<5?String(values.color):"#0000ff"):"#ff0000"}}/>;
    }`);
      const manifest = join(directory, "custom.forgecut");
      await state.saveProject(manifest);
      await state.loadProject(manifest);
      const version = state.project.components![0].version;
      const output = join(directory, "custom.mp4");
      expect(await exportProject(state.project, output)).toMatchObject({
        ok: true,
      });
      const decode = (path: string) =>
        spawnSync("ffmpeg", [
          "-v",
          "error",
          "-threads",
          "1",
          "-i",
          path,
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "-threads",
          "1",
          "pipe:1",
        ]);
      const frames = decode(output);
      expect(frames.status, frames.stderr.toString()).toBe(0);
      expect(frames.stdout.length).toBe(10 * 64 * 36 * 3);
      expect(frames.stdout[1]).toBeGreaterThan(180);
      expect(frames.stdout[2]).toBeLessThan(110);
      expect(frames.stdout[5 * 64 * 36 * 3 + 2]).toBeGreaterThan(240);
      const item = state.project.timeline.tracks[0].items[0];
      if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
      await service.execute("update_item", {
        itemId: item.RemotionGraphic.id,
        patch: {
          kind: "RemotionGraphic",
          changes: { props: { color: "#ffff00" } },
        },
      });
      const changed = join(directory, "changed.mp4");
      expect(await exportProject(state.project, changed)).toMatchObject({
        ok: true,
      });
      const yellow = decode(changed);
      expect(yellow.status).toBe(0);
      expect(yellow.stdout[0]).toBeGreaterThan(240);
      expect(yellow.stdout[1]).toBeGreaterThan(240);
      expect(state.project.components![0].version).toBe(version);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  120000,
);
it.skipIf(!available)(
  "keeps the previous destination when project source throws at render time",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-custom-error-"));
    try {
      const { state } = await fixture(
        'export default function Card(){throw new Error("Draft runtime failure");return null;}',
      );
      const output = join(directory, "previous.mp4");
      await writeFile(output, "previous approved render");
      expect(await exportProject(state.project, output)).toMatchObject({
        ok: false,
      });
      expect(await readFile(output, "utf8")).toBe("previous approved render");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  120000,
);
