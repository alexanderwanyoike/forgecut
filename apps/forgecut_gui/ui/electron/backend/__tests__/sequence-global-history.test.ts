/** @vitest-environment node */
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("keeps a project rename global even when another sequence is active", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  try {
    await service.execute("create_sequence", { name: "Clip" });
    const root = state.project.default_sequence!.id;
    const clip = state.project.sequences![0].id;
    state.selectSequence(state.sessionId, clip);
    const before = structuredClone(state.project);
    expect(
      await service.execute("apply_edits", {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: randomUUID(),
        operations: [{ command: "update_project", args: { name: "Campaign" } }],
      }),
    ).toMatchObject({ ok: true });
    expect(state.project.name).toBe("Campaign");
    expect(state.snapshot().undoSequenceId).toBeUndefined();
    expect(state.snapshot().activeSequenceId).toBe(clip);
    state.selectSequence(state.sessionId, root);
    expect(
      await service.execute("apply_history", {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: randomUUID(),
        direction: "undo",
      }),
    ).toMatchObject({ ok: true });
    expect(state.project).toEqual(before);
  } finally {
    await service.jobs.close();
    await service.closeGraphicsPreview();
  }
});
