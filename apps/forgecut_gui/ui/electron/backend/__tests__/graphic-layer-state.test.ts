/** @vitest-environment node */
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("keeps layer visibility locking and order separate from component source and undoable", async () => {
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
  const before = state.snapshot();
  const layer = state.project.components![0].layers[1];
  expect(
    await service.execute("update_item", {
      itemId: item.RemotionGraphic.id,
      patch: {
        kind: "RemotionGraphic",
        changes: {
          layer_states: {
            [layer.id]: { hidden: true, locked: true, order: 5 },
          },
        },
      },
    }),
  ).toMatchObject({ ok: true });
  expect(state.project.components).toEqual(before.project.components);
  expect(
    await service.execute("set_editing_context", {
      sessionId: state.sessionId,
      selectedItemIds: [item.RemotionGraphic.id],
      selectedLayerIds: [layer.id],
      playheadUs: 0,
    }),
  ).toMatchObject({ ok: true, value: { selectedLayerIds: [layer.id] } });
  const edited = state.snapshot();
  expect(
    await service.execute("update_item", {
      itemId: item.RemotionGraphic.id,
      patch: {
        kind: "RemotionGraphic",
        changes: {
          layer_states: {
            "00000000-0000-4000-8000-000000000000": { hidden: true },
          },
        },
      },
    }),
  ).toMatchObject({ ok: false });
  expect(state.snapshot()).toEqual(edited);
  await service.execute("undo");
  expect(state.project).toEqual(before.project);
  await service.execute("delete_clip", { itemId: item.RemotionGraphic.id });
  expect(state.getEditingContext()).toMatchObject({
    selectedItemIds: [],
    selectedLayerIds: [],
  });
});
