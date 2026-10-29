/** @vitest-environment node */
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
it("rejects changes to locked layer bindings from the shared editing service", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  await service.execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 0,
    durationUs: 1000000,
  });
  const item = state.project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
  const layerId = state.project.components![0].layers[1].id;
  await service.execute("update_item", {
    itemId: item.RemotionGraphic.id,
    patch: {
      kind: "RemotionGraphic",
      changes: { layer_states: { [layerId]: { locked: true } } },
    },
  });
  const before = state.snapshot();
  expect(
    await service.execute("update_item", {
      itemId: item.RemotionGraphic.id,
      patch: { kind: "RemotionGraphic", changes: { props: { title_x: 400 } } },
    }),
  ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  expect(state.snapshot()).toEqual(before);
  expect(
    await service.execute("update_item", {
      itemId: item.RemotionGraphic.id,
      patch: {
        kind: "RemotionGraphic",
        changes: {
          props: { alignment: "center", animation: "none", entrance_frames: 0 },
        },
      },
    }),
  ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  expect(state.snapshot()).toEqual(before);
  expect(
    await service.execute("update_item", {
      itemId: item.RemotionGraphic.id,
      patch: {
        kind: "RemotionGraphic",
        changes: {
          props: { title_x: 400 },
          layer_states: { [layerId]: { locked: false } },
        },
      },
    }),
  ).toMatchObject({ ok: true });
});
