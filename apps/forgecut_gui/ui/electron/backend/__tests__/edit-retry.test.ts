/** @vitest-environment node */
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("returns the original edit response after intervening changes", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  const request = {
    sessionId: state.sessionId,
    expectedRevision: state.revision,
    requestId: "first-edit",
    operations: [{ command: "update_project", args: { name: "First" } }],
  };
  const first = await service.execute("apply_edits", request);
  expect(first.ok).toBe(true);
  await service.execute("update_project", { name: "Later" });
  expect(await service.execute("apply_edits", request)).toEqual(first);
  expect(state.project.name).toBe("Later");
});
