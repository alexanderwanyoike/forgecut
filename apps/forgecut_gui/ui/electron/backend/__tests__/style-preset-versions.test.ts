/** @vitest-environment node */
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { prepareGraphicPromotion } from "../graphic-promotion-candidate";

it("retains the exact component version captured by a preset when shared source is promoted", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  try {
    await service.execute("add_graphic_item", {
      templateId: "title-card",
      trackId: "graphics",
      timelineStartUs: 0,
      durationUs: 1000000,
    });
    const source = state.project.timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in source)) throw new Error("Missing card");
    const original = state.project.components![0];
    const preset = await service.execute("save_style_preset", {
      sourceSequenceId: state.project.default_sequence!.id,
      itemId: source.RemotionGraphic.id,
      name: "Original card",
      purpose: "card",
    });
    expect(preset).toMatchObject({ ok: true });
    if (!preset.ok) throw new Error(preset.error.message);
    const component = structuredClone(original);
    component.source.files[component.source.entry] +=
      "\nexport const styleRevision = 2;\n";
    const promoted = prepareGraphicPromotion(
      state.project,
      {
        projectId: state.project.id,
        itemId: source.RemotionGraphic.id,
        baseVersion: original.version,
        revision: 1,
        component,
      },
      { itemId: source.RemotionGraphic.id, scope: "shared" },
    );
    expect(promoted).toMatchObject({ ok: true });
    if (!promoted.ok) throw new Error(promoted.error.message);
    state.executeProjectChange((project) =>
      Object.assign(project, promoted.value.project),
    );
    expect(state.project.components).toContainEqual(original);
    expect(promoted.value.version).not.toBe(original.version);
    expect(state.project.timeline.tracks[0].items[0]).toMatchObject({
      RemotionGraphic: { component_version: promoted.value.version },
    });
    expect(
      await service.execute("add_graphic_from_preset", {
        presetId: (preset.value as { id: string }).id,
        trackId: "graphics",
        timelineStartUs: 2000000,
        durationUs: 1000000,
      }),
    ).toMatchObject({ ok: true });
    expect(state.project.timeline.tracks[0].items[1]).toMatchObject({
      RemotionGraphic: { component_version: original.version },
    });
  } finally {
    await service.jobs.close();
    await service.closePreviews();
  }
});
