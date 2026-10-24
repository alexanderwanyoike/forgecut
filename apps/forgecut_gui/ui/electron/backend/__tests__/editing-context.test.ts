/** @vitest-environment node */
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("tracks selection and playhead independently from creative project revisions", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  await service.execute("add_text_overlay", {
    trackId: "titles",
    timelineStartUs: 0,
    durationUs: 1000000,
    text: "Title",
    fontSize: 48,
    color: "#ffffff",
    x: 0,
    y: 0,
  });
  const item = state.project.timeline.tracks[0].items[0];
  if (!("TextOverlay" in item)) throw new Error("Expected title");
  const before = state.snapshot();
  const updated = await service.execute("set_editing_context", {
    sessionId: state.sessionId,
    selectedItemIds: [item.TextOverlay.id],
    playheadUs: 250000,
  });
  expect(updated).toMatchObject({
    ok: true,
    value: {
      selectedItemIds: [item.TextOverlay.id],
      playheadUs: 250000,
      contextRevision: 1,
    },
  });
  expect(state.snapshot()).toEqual(before);
  await service.execute("delete_clip", { itemId: item.TextOverlay.id });
  expect(await service.execute("get_editing_context")).toMatchObject({
    ok: true,
    value: { selectedItemIds: [], contextRevision: 2 },
  });
  const previousSession = state.sessionId;
  state.createProject();
  expect(
    await service.execute("set_editing_context", {
      sessionId: previousSession,
      selectedItemIds: [],
      playheadUs: 500000,
    }),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_CHANGED" } });
});
