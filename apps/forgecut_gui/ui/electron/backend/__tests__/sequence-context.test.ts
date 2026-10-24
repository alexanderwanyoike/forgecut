/** @vitest-environment node */
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("switches sequence context without creative edits and restores each playhead", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  expect(
    await service.execute("create_sequence", { name: "Clip" }),
  ).toMatchObject({ ok: true });
  const root = state.project.default_sequence!.id;
  const clip = state.project.sequences![0].id;
  await service.execute("set_editing_context", {
    sessionId: state.sessionId,
    selectedItemIds: [],
    playheadUs: 1000000,
  });
  const before = state.snapshot();
  expect(
    await service.execute("select_sequence", {
      sessionId: state.sessionId,
      sequenceId: clip,
    }),
  ).toMatchObject({
    ok: true,
    value: {
      activeSequenceId: clip,
      selectedItemIds: [],
      selectedLayerIds: [],
      playheadUs: 0,
    },
  });
  expect(state.revision).toBe(before.revision);
  expect(state.project).toEqual(before.project);
  await service.execute("set_editing_context", {
    sessionId: state.sessionId,
    selectedItemIds: [],
    playheadUs: 500000,
  });
  expect(
    await service.execute("select_sequence", {
      sessionId: state.sessionId,
      sequenceId: root,
    }),
  ).toMatchObject({
    ok: true,
    value: { activeSequenceId: root, playheadUs: 1000000 },
  });
  expect(
    await service.execute("select_sequence", {
      sessionId: state.sessionId,
      sequenceId: clip,
    }),
  ).toMatchObject({
    ok: true,
    value: { activeSequenceId: clip, playheadUs: 500000 },
  });
  expect(
    await service.execute("select_sequence", {
      sessionId: crypto.randomUUID(),
      sequenceId: root,
    }),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_CHANGED" } });
  expect(state.revision).toBe(before.revision);
  await service.jobs.close();
  await service.closeGraphicsPreview();
});
