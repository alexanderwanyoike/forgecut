import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dispatchLocal } from "../dispatch";
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

it("reports the snapshot actually saved while later manual edits remain open", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-save-revision-"));
  try {
    const state = new AppState();
    const service = new EditingService(state);
    await service.execute("update_project", { name: "Saved version" });
    const revision = state.revision;
    const path = join(directory, "saved.forgecut");
    const saving = dispatchLocal(service, {
      action: "save",
      sessionId: state.sessionId,
      expectedRevision: revision,
      path,
    });
    await service.execute("update_project", { name: "Later manual edit" });
    expect(await saving).toMatchObject({
      ok: true,
      value: { saved: true, revision },
    });
    expect(JSON.parse(await readFile(path, "utf8")).name).toBe("Saved version");
    expect(state.project.name).toBe("Later manual edit");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
