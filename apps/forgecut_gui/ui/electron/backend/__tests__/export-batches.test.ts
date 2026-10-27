/** @vitest-environment node */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("captures an export batch on disk without changing the editor or overwriting an existing batch", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecut-batch-"));
  const directory = join(root, "outputs");
  const state = new AppState();
  const service = new EditingService(state);
  try {
    await service.execute("update_project", { name: "Captured cut" });
    const before = state.snapshot();
    const request = {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      directory,
      sequenceIds: [state.project.default_sequence!.id],
      preset: "webm",
    };
    const created = await service.execute("create_export_batch", request);
    expect(created).toMatchObject({
      ok: true,
      value: {
        projectName: "Captured cut",
        entries: [{ status: "pending", preset: "webm" }],
      },
    });
    expect(state.snapshot()).toEqual(before);
    const saved = await readFile(join(directory, "batch.json"), "utf8");
    const captured = JSON.parse(
      await readFile(join(directory, "project.forgecut"), "utf8"),
    );
    expect(captured).toEqual(before.project);
    await service.execute("update_project", { name: "Later manual cut" });
    expect(
      await service.execute("get_export_batch", { directory }),
    ).toMatchObject({
      ok: true,
      value: { projectName: "Captured cut", entries: [{ status: "pending" }] },
    });
    expect(
      await service.execute("create_export_batch", {
        ...request,
        expectedRevision: state.revision,
      }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(await readFile(join(directory, "batch.json"), "utf8")).toBe(saved);
  } finally {
    await service.jobs.close();
    await service.closeGraphicsPreview();
    await rm(root, { recursive: true, force: true });
  }
});
