/** @vitest-environment node */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

afterEach(() => vi.unstubAllEnvs());
it("imports and selects a font atomically without changing component source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-font-binding-"));
  try {
    vi.stubEnv("FORGECUT_RESOURCE_DIR", join(directory, "cache"));
    const font = join(directory, "fixture.ttf");
    await writeFile(font, Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    const license = join(directory, "LICENSE.txt");
    await writeFile(license, "Generated fixture, not a renderable font");
    const state = new AppState();
    const service = new EditingService(state);
    await service.execute("add_graphic_item", {
      templateId: "title-card",
      trackId: "graphics",
      timelineStartUs: 0,
      durationUs: 1000000,
    });
    const item = state.project.timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in item)) throw new Error("Invalid fixture");
    const before = structuredClone(state.project);
    const selected = await service.execute("import_graphic_resource", {
      path: font,
      kind: "Font",
      licensePath: license,
      target: {
        itemId: item.RemotionGraphic.id,
        property: "font",
        sessionId: state.sessionId,
        expectedRevision: state.revision,
      },
    });
    expect(selected).toMatchObject({ ok: true });
    const resource = state.project.resources![0];
    expect(state.project.timeline.tracks[0].items[0]).toMatchObject({
      RemotionGraphic: {
        props: { font: resource.id },
        component_version: item.RemotionGraphic.component_version,
      },
    });
    expect(resource.license.text).toContain("Generated fixture");
    await service.execute("undo");
    expect(state.project).toEqual(before);
    const unchanged = state.snapshot();
    expect(
      await service.execute("update_item", {
        itemId: item.RemotionGraphic.id,
        patch: {
          kind: "RemotionGraphic",
          changes: { props: { font: "missing-font" } },
        },
      }),
    ).toMatchObject({ ok: false });
    expect(state.snapshot()).toEqual(unchanged);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("rejects a font choice begun before the same saved project was reopened", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-font-origin-"));
  try {
    const state = new AppState();
    const service = new EditingService(state);
    await service.execute("add_graphic_item", {
      templateId: "title-card",
      trackId: "graphics",
      timelineStartUs: 0,
      durationUs: 1000000,
    });
    const item = state.project.timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in item)) throw new Error("Invalid fixture");
    const origin = {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
    };
    const path = join(directory, "film.forgecut");
    await state.saveProject(path);
    await state.loadProject(path);
    const before = state.snapshot();
    expect(
      await service.execute("import_graphic_resource", {
        path: "/not-read.ttf",
        kind: "Font",
        license: { identifier: "test", text: "Fixture" },
        target: {
          itemId: item.RemotionGraphic.id,
          property: "font",
          ...origin,
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "PROJECT_CHANGED" } });
    expect(state.snapshot()).toEqual(before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
