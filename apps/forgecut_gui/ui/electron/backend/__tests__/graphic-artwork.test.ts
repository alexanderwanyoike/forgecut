/** @vitest-environment node */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { graphicResourceInputs } from "../graphic-inputs";

const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
afterEach(() => vi.unstubAllEnvs());
it("imports and selects owned artwork with independent image geometry and exact render bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-artwork-"));
  try {
    vi.stubEnv("FORGECUT_RESOURCE_DIR", join(directory, "cache"));
    const path = join(directory, "art.png");
    await writeFile(path, image);
    const state = new AppState();
    const service = new EditingService(state);
    await service.execute("add_graphic_item", {
      templateId: "title-card",
      trackId: "graphics",
      timelineStartUs: 0,
      durationUs: 1000000,
      props: { title: "Octane" },
    });
    const item = state.project.timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in item)) throw new Error("Invalid fixture");
    const before = structuredClone(state.project);
    expect(
      await service.execute("import_graphic_resource", {
        path,
        kind: "Image",
        license: { identifier: "test", text: "Generated fixture" },
        target: {
          itemId: item.RemotionGraphic.id,
          property: "image",
          sessionId: state.sessionId,
          expectedRevision: state.revision,
        },
      }),
    ).toMatchObject({ ok: true });
    const resource = state.project.resources![0];
    expect(resource).toMatchObject({ width: 1, height: 1 });
    const edited = state.project.timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in edited)) throw new Error("Invalid graphic");
    expect(edited.RemotionGraphic.props).toMatchObject({
      title: "Octane",
      image: resource.id,
      image_x: 0,
      image_y: 0,
      image_width: 1920,
      image_height: 1080,
    });
    expect(edited.RemotionGraphic.component_version).toBe(
      item.RemotionGraphic.component_version,
    );
    const component = state.project.components![0];
    const inputs = await graphicResourceInputs(
      state.project,
      component,
      edited.RemotionGraphic.props,
    );
    expect(inputs).toMatchObject({
      ok: true,
      value: {
        [resource.id]: {
          url: `data:image/png;base64,${image.toString("base64")}`,
          sha256: resource.sha256,
        },
      },
    });
    await service.execute("undo");
    expect(state.project).toEqual(before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("rejects oversized decoded image dimensions before importing the resource", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-image-bounds-"));
  try {
    vi.stubEnv("FORGECUT_RESOURCE_DIR", join(directory, "cache"));
    const bomb = Buffer.from(image);
    bomb.writeUInt32BE(100000, 16);
    const path = join(directory, "oversized.png");
    await writeFile(path, bomb);
    const state = new AppState();
    const before = state.snapshot();
    expect(
      await new EditingService(state).execute("import_graphic_resource", {
        path,
        kind: "Image",
        license: { identifier: "test", text: "Generated header" },
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(state.snapshot()).toEqual(before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
