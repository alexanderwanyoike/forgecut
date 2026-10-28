/** @vitest-environment node */
import { writeFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { componentVersion } from "../graphic-component";
import { GraphicRenderCache } from "../GraphicRenderCache";
import type { GraphicRenderJob } from "../graphic-render-job";

const compile = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../graphic-source-check", async (actual) => {
  const module = await actual<typeof import("../graphic-source-check")>();
  return {
    ...module,
    checkGraphicSource: (
      ...args: Parameters<typeof module.checkGraphicSource>
    ) => {
      compile.calls += 1;
      return module.checkGraphicSource(...args);
    },
  };
});

let renders: GraphicRenderCache | undefined;
afterEach(async () => {
  await renders?.close();
});

it("compiles project source once for cards that share a component version", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  for (const title of ["First", "Second"])
    await service.execute("add_graphic_item", {
      templateId: "title-card",
      trackId: "graphics",
      timelineStartUs: title === "First" ? 0 : 1000000,
      durationUs: 1000000,
      props: { title },
    });
  const project = structuredClone(state.project);
  const [component] = project.components!;
  component.source.files[component.source.entry] += "\n// project copy\n";
  component.version = componentVersion(component);
  const cards = project.timeline.tracks
    .flatMap((track) => track.items)
    .flatMap((item) =>
      "RemotionGraphic" in item ? [item.RemotionGraphic] : [],
    );
  for (const card of cards) card.component_version = component.version;
  renders = new GraphicRenderCache(async (job: GraphicRenderJob) => {
    await writeFile(job.output, "");
    return { ok: true, value: job.output };
  });
  for (const card of cards)
    expect(await renders.prepare(project, card.id)).toMatchObject({ ok: true });
  expect(compile.calls).toBe(1);
}, 60000);
