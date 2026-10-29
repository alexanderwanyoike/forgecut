/** @vitest-environment node */
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
afterEach(() => vi.unstubAllEnvs());
it("assigns imported artwork to a graphic in another sequence as one scoped action", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-sequence-art-"));
  const state = new AppState();
  const service = new EditingService(state);
  try {
    vi.stubEnv("FORGECUT_RESOURCE_DIR", join(directory, "cache"));
    const path = join(directory, "art.png");
    await writeFile(path, image);
    await service.execute("create_sequence", { name: "Clip" });
    const clip = state.project.sequences![0].id;
    expect(
      await service.execute("apply_edits", {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: crypto.randomUUID(),
        sequenceId: clip,
        operations: [
          {
            command: "add_graphic_item",
            args: {
              templateId: "title-card",
              trackId: "clip-graphics",
              timelineStartUs: 0,
              durationUs: 1000000,
              props: { title: "Keep these words" },
            },
          },
        ],
      }),
    ).toMatchObject({ ok: true });
    const item = state.project.sequences![0].timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
    const before = structuredClone(state.project);
    expect(
      await service.execute("import_graphic_resource", {
        path,
        kind: "Image",
        license: { identifier: "fixture", text: "Generated test image" },
        target: {
          itemId: item.RemotionGraphic.id,
          property: "image",
          sessionId: state.sessionId,
          expectedRevision: state.revision,
        },
      }),
    ).toMatchObject({ ok: true });
    expect(state.project.timeline).toEqual(before.timeline);
    expect(
      state.project.sequences![0].timeline.tracks[0].items[0],
    ).toMatchObject({
      RemotionGraphic: {
        props: {
          title: "Keep these words",
          image: state.project.resources![0].id,
        },
      },
    });
    expect(state.snapshot().undoSequenceId).toBe(clip);
    expect(state.snapshot().activeSequenceId).toBe(
      state.project.default_sequence!.id,
    );
    state.undo(clip);
    expect(state.project).toEqual(before);
  } finally {
    await service.jobs.close();
    await service.closePreviews();
    await rm(directory, { recursive: true, force: true });
  }
});
it("owns imported graphic artwork and carries bytes and licence metadata when the project moves", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-resources-"));
  try {
    vi.stubEnv("FORGECUT_RESOURCE_DIR", join(directory, "cache"));
    const source = join(directory, "art.png");
    await writeFile(source, image);
    const state = new AppState();
    const service = new EditingService(state);
    const imported = await service.execute("import_graphic_resource", {
      path: source,
      kind: "Image",
      license: { identifier: "test-only", text: "Generated test fixture" },
    });
    expect(imported).toMatchObject({
      ok: true,
      value: {
        kind: "Image",
        mime: "image/png",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        path: expect.stringMatching(/^\.forgecut-resources\/[a-f0-9]{64}$/),
      },
    });
    const resource = state.project.resources![0];
    const before = structuredClone(state.project);
    await service.execute("undo");
    expect(state.project.resources).toEqual([]);
    await service.execute("redo");
    expect(state.project).toEqual(before);
    const manifest = join(directory, "film.forgecut");
    await state.saveProject(manifest);
    await rm(source);
    expect(await readFile(join(directory, resource.path))).toEqual(image);
    const moved = join(directory, "moved");
    await mkdir(moved);
    await cp(manifest, join(moved, "film.forgecut"));
    await cp(
      join(directory, ".forgecut-resources"),
      join(moved, ".forgecut-resources"),
      { recursive: true },
    );
    await rm(join(directory, "cache"), { recursive: true });
    const reopened = new AppState();
    await reopened.loadProject(join(moved, "film.forgecut"));
    expect(reopened.project).toEqual(before);
    expect(await readFile(join(directory, "cache", resource.sha256))).toEqual(
      image,
    );
    await writeFile(join(moved, resource.path), "corrupt artwork");
    const unchanged = reopened.snapshot();
    await expect(
      reopened.loadProject(join(moved, "film.forgecut")),
    ).rejects.toThrow(/resource|content|hash/i);
    expect(reopened.snapshot()).toEqual(unchanged);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("rejects a fake font without changing history or active project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-font-"));
  try {
    vi.stubEnv("FORGECUT_RESOURCE_DIR", join(directory, "cache"));
    const path = join(directory, "fake.ttf");
    await writeFile(path, "not a font");
    const state = new AppState();
    const before = state.snapshot();
    expect(
      await new EditingService(state).execute("import_graphic_resource", {
        path,
        kind: "Font",
        license: { identifier: "test-only", text: "Generated fixture" },
      }),
    ).toMatchObject({ ok: false });
    expect(state.snapshot()).toEqual(before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("discards a resource import whose project changes during file reading", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-resource-race-"));
  try {
    vi.stubEnv("FORGECUT_RESOURCE_DIR", join(directory, "cache"));
    const path = join(directory, "art.png");
    await writeFile(path, image);
    const state = new AppState();
    const pending = new EditingService(state).execute(
      "import_graphic_resource",
      {
        path,
        kind: "Image",
        license: { identifier: "test-only", text: "Generated fixture" },
      },
    );
    queueMicrotask(() => state.createProject());
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: "PROJECT_CHANGED" },
    });
    expect(state.project.resources).toEqual([]);
    expect(state.canUndo).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
