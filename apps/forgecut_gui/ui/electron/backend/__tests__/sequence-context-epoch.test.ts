/** @vitest-environment node */
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("rejects a context packet from an earlier activation of the same sequence", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  try {
    await service.execute("create_sequence", { name: "Clip" });
    const root = state.project.default_sequence!.id;
    const clip = state.project.sequences![0].id;
    const packet = {
      sessionId: state.sessionId,
      sequenceId: root,
      sequenceRevision: state.snapshot().sequenceRevision,
      selectedItemIds: [],
      playheadUs: 1000000,
    };
    expect(await service.execute("set_editing_context", packet)).toMatchObject({
      ok: true,
    });
    state.selectSequence(state.sessionId, clip);
    state.selectSequence(state.sessionId, root);
    const before = state.getEditingContext();
    expect(
      await service.execute("set_editing_context", {
        ...packet,
        playheadUs: 2000000,
      }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(state.getEditingContext()).toEqual(before);
  } finally {
    await service.jobs.close();
    await service.closePreviews();
  }
});
