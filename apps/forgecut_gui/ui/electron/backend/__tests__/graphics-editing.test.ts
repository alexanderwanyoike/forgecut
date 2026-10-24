/** @vitest-environment node */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("creates an editable title with a pinned component version and keeps instance edits separate from source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-graphics-"));
  try {
    const state = new AppState();
    const service = new EditingService(state);
    expect(
      await service.execute("add_graphic_item", {
        templateId: "title-card",
        trackId: "graphics",
        timelineStartUs: 0,
        durationUs: 2000000,
        props: { title: "Octane", color: "#e6e6e6" },
      }),
    ).toMatchObject({ ok: true });
    const before = structuredClone(state.project);
    const snapshot = await service.execute("get_project_snapshot");
    expect(snapshot).toMatchObject({
      ok: true,
      value: {
        project: {
          components: [
            {
              version: expect.stringMatching(/^[a-f0-9]{64}$/),
              source: {
                entry: "main.tsx",
                files: {
                  "main.tsx": expect.stringContaining("export default"),
                },
              },
            },
          ],
          timeline: {
            tracks: [
              {
                kind: "Graphics",
                items: [
                  {
                    RemotionGraphic: {
                      props: { title: "Octane", color: "#e6e6e6" },
                      component_version:
                        expect.stringMatching(/^[a-f0-9]{64}$/),
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    });
    const details = await service.execute("get_sequence_frame", {
      playheadUs: 0,
    });
    expect(details).toMatchObject({
      ok: true,
      value: {
        durationUs: 2000000,
        layers: [{ item: { RemotionGraphic: { id: expect.any(String) } } }],
      },
    });
    const created = state.project.timeline.tracks[0].items[0] as unknown as {
      RemotionGraphic: { id: string };
    };
    expect(
      await service.execute("update_item", {
        itemId: created.RemotionGraphic.id,
        patch: {
          kind: "RemotionGraphic",
          changes: { props: { title: "Your build", color: "#a4c3b5" } },
        },
      }),
    ).toMatchObject({ ok: true });
    expect(
      await service.execute("get_sequence_frame", { playheadUs: 0 }),
    ).toMatchObject({
      ok: true,
      value: {
        layers: [
          { item: { RemotionGraphic: { props: { title: "Your build" } } } },
        ],
      },
    });
    await service.execute("undo");
    expect(state.project).toEqual(before);
    const path = join(directory, "graphic.forgecut");
    await state.saveProject(path);
    await state.loadProject(path);
    expect(state.project).toEqual(before);
    const unchanged = state.snapshot();
    expect(
      await service.execute("update_item", {
        itemId: created.RemotionGraphic.id,
        patch: { kind: "RemotionGraphic", changes: { props: { title: 4 } } },
      }),
    ).toMatchObject({ ok: false });
    expect(state.snapshot()).toEqual(unchanged);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
