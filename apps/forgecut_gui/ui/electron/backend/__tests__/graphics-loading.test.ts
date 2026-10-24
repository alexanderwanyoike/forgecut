/** @vitest-environment node */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { componentVersion } from "../graphic-component";

it("rejects absolute component workspace paths without replacing the open project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-graphic-load-"));
  try {
    const state = new AppState();
    const service = new EditingService(state);
    await service.execute("add_graphic_item", {
      templateId: "title-card",
      trackId: "graphics",
      timelineStartUs: 0,
      durationUs: 1000000,
    });
    const before = state.snapshot();
    const file = structuredClone(state.project);
    const component = file.components![0];
    const content = component.source.files[component.source.entry];
    component.source = {
      entry: "C:\\private\\main.tsx",
      files: { "C:\\private\\main.tsx": content },
    };
    component.version = componentVersion(component);
    const item = file.timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in item))
      throw new Error("Invalid graphic fixture");
    item.RemotionGraphic.component_version = component.version;
    const path = join(directory, "bad.forgecut");
    await writeFile(path, JSON.stringify(file));
    await expect(state.loadProject(path)).rejects.toThrow();
    expect(state.snapshot()).toEqual(before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
