/** @vitest-environment node */
import { expect, it } from "vitest";
import { AppState } from "../../backend/state";
import { EditingService } from "../../backend/editing-service";

it("guards history revisions and deduplicates a history retry after intervening edits", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  await service.execute("update_project", { name: "First" });
  const request = {
    sessionId: state.sessionId,
    expectedRevision: state.revision,
    requestId: "undo-first",
    direction: "undo",
  };
  const undone = await service.execute("apply_history", request);
  expect(undone).toMatchObject({
    ok: true,
    value: { project: { name: "Untitled" }, revision: 2 },
  });
  await service.execute("update_project", { name: "Later" });
  expect(await service.execute("apply_history", request)).toEqual(undone);
  expect(state.project.name).toBe("Later");
  expect(
    await service.execute("apply_history", { ...request, requestId: "stale" }),
  ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
});
