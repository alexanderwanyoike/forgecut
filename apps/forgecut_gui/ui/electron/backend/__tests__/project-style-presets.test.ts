/** @vitest-environment node */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("saves a project card style and creates independently editable instances with overrides after reopening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-project-styles-"));
  const state = new AppState();
  const service = new EditingService(state);
  try {
    expect(
      await service.execute("add_graphic_item", {
        templateId: "title-card",
        trackId: "graphics",
        timelineStartUs: 0,
        durationUs: 1000000,
        props: { title: "Quiet opening", color: "#8293a4", font_size: 52 },
      }),
    ).toMatchObject({ ok: true });
    const source = state.project.timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in source)) throw new Error("Missing card");
    const before = state.snapshot();
    const saved = await service.execute("save_style_preset", {
      sourceSequenceId: state.project.default_sequence!.id,
      itemId: source.RemotionGraphic.id,
      name: "Octane card",
      purpose: "card",
    });
    expect(saved).toMatchObject({
      ok: true,
      value: {
        name: "Octane card",
        purpose: "card",
        component_id: source.RemotionGraphic.component_id,
        component_version: source.RemotionGraphic.component_version,
        props: { title: "Quiet opening", color: "#8293a4", font_size: 52 },
      },
    });
    if (!saved.ok) throw new Error(saved.error.message);
    const preset = saved.value as { id: string };
    expect(state.project.timeline).toEqual(before.project.timeline);
    expect(state.snapshot().undoSequenceId).toBeUndefined();
    expect(
      await service.execute("update_item", {
        itemId: source.RemotionGraphic.id,
        patch: {
          kind: "RemotionGraphic",
          changes: { props: { color: "#555555" } },
        },
      }),
    ).toMatchObject({ ok: true });
    const path = join(directory, "styles.forgecut");
    await state.saveProject(path);
    const reopened = new AppState();
    await reopened.loadProject(path);
    expect(reopened.project).toEqual(state.project);
    const owner = new EditingService(reopened);
    try {
      const inserted = await owner.execute("add_graphic_from_preset", {
        presetId: preset.id,
        trackId: "graphics",
        timelineStartUs: 2000000,
        durationUs: 1000000,
        overrides: { title: "Instance wording" },
      });
      expect(inserted).toMatchObject({ ok: true });
      const copy = reopened.project.timeline.tracks[0].items[1];
      if (!("RemotionGraphic" in copy))
        throw new Error("Missing preset instance");
      expect(copy.RemotionGraphic.props).toMatchObject({
        title: "Instance wording",
        color: "#8293a4",
        font_size: 52,
      });
      expect(copy.RemotionGraphic.id).not.toBe(source.RemotionGraphic.id);
      expect(reopened.project).toMatchObject({ style_presets: [saved.value] });
      const original = reopened.project.timeline.tracks[0].items[0];
      expect(original).toMatchObject({
        RemotionGraphic: { props: { color: "#555555" } },
      });
      const published = reopened.snapshot();
      expect(
        await owner.execute("add_graphic_from_preset", {
          presetId: preset.id,
          trackId: "graphics",
          timelineStartUs: 4000000,
          durationUs: 1000000,
          overrides: { color: "invalid" },
        }),
      ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
      expect(reopened.snapshot()).toEqual(published);
    } finally {
      await owner.jobs.close();
      await owner.closeGraphicsPreview();
    }
  } finally {
    await service.jobs.close();
    await service.closeGraphicsPreview();
    await rm(directory, { recursive: true, force: true });
  }
});
