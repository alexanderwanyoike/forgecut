/** @vitest-environment node */
import { afterEach, expect, it } from "vitest";
import type { StylePreset } from "../../shared/style-presets";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

const services: EditingService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) {
    await service.jobs.close();
    await service.closePreviews();
  }
});
async function fixture() {
  const state = new AppState();
  const service = new EditingService(state);
  services.push(service);
  await service.execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 0,
    durationUs: 1000000,
    props: { color: "#8293a4" },
  });
  const item = state.project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Missing card");
  const input = {
    sourceSequenceId: state.project.default_sequence!.id,
    itemId: item.RemotionGraphic.id,
    name: "Project card",
    purpose: "card",
  };
  const saved = await service.execute("save_style_preset", input);
  expect(saved).toMatchObject({ ok: true });
  if (!saved.ok) throw new Error(saved.error.message);
  const preset = saved.value as StylePreset;
  await service.execute("add_graphic_from_preset", {
    presetId: preset.id,
    trackId: "graphics",
    timelineStartUs: 2000000,
    durationUs: 1000000,
  });
  return { state, service, preset, input };
}

it("replaces a saved style explicitly without changing previously created instances and undoes the replacement once", async () => {
  const { state, service, preset, input } = await fixture();
  await service.execute("update_item", {
    itemId: input.itemId,
    patch: {
      kind: "RemotionGraphic",
      changes: { props: { color: "#aabbcc" } },
    },
  });
  const before = state.snapshot();
  expect(
    await service.execute("save_style_preset", {
      ...input,
      presetId: preset.id,
      name: "Updated ending",
      purpose: "ending",
    }),
  ).toMatchObject({
    ok: true,
    value: { id: preset.id, purpose: "ending", props: { color: "#aabbcc" } },
  });
  expect(state.project.style_presets).toHaveLength(1);
  expect(state.project.timeline).toEqual(before.project.timeline);
  expect(state.snapshot().undoSequenceId).toBeUndefined();
  expect(await service.execute("undo")).toMatchObject({ ok: true });
  expect(state.project).toEqual(before.project);
  expect(await service.execute("redo")).toMatchObject({ ok: true });
  const updated = state.snapshot();
  expect(
    await service.execute("save_style_preset", {
      ...input,
      presetId: "00000000-0000-4000-8000-000000000099",
    }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  expect(state.snapshot()).toEqual(updated);
});

it("deletes a saved style without changing its instances and restores it with one global undo", async () => {
  const { state, service, preset } = await fixture();
  const before = state.snapshot();
  expect(
    await service.execute("delete_style_preset", { presetId: preset.id }),
  ).toMatchObject({ ok: true });
  expect(state.project.style_presets).toEqual([]);
  expect(state.project.timeline).toEqual(before.project.timeline);
  expect(state.snapshot().undoSequenceId).toBeUndefined();
  await service.execute("undo");
  expect(state.project).toEqual(before.project);
  await service.execute("redo");
  const deleted = state.snapshot();
  expect(
    await service.execute("delete_style_preset", { presetId: preset.id }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  expect(state.snapshot()).toEqual(deleted);
});
