/** @vitest-environment node */
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("rejects colliding saved entries before resuming or replacing an output", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecut-batch-records-"));
  const directory = join(root, "outputs");
  const state = new AppState();
  const service = new EditingService(state);
  try {
    const created = await service.execute("create_export_batch", {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      directory,
      sequenceIds: [state.project.default_sequence!.id],
    });
    if (!created.ok) throw new Error(created.error.message);
    const path = join(directory, "batch.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.entries.push({ ...manifest.entries[0] });
    await writeFile(path, JSON.stringify(manifest));
    const output = join(directory, manifest.entries[0].outputFile);
    await writeFile(output, "Keep this output");
    expect(
      await service.execute("get_export_batch", { directory }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(
      await service.execute("resume_export_batch", {
        directory,
        batchId: manifest.id,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(await readFile(output, "utf8")).toBe("Keep this output");
  } finally {
    await service.batches.close();
    await service.jobs.close();
    await service.closeGraphicsPreview();
    await rm(root, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")(
  "reports a failed durable checkpoint instead of silently returning to pending",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "forgecut-batch-checkpoint-"));
    const directory = join(root, "outputs");
    const state = new AppState();
    const service = new EditingService(state);
    try {
      const created = await service.execute("create_export_batch", {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        directory,
        sequenceIds: [state.project.default_sequence!.id],
      });
      if (!created.ok) throw new Error(created.error.message);
      const batch = created.value as { id: string };
      await chmod(directory, 0o500);
      expect(
        await service.execute("resume_export_batch", {
          directory,
          batchId: batch.id,
        }),
      ).toMatchObject({ ok: true });
      let result = await service.execute("get_export_batch", { directory });
      for (let attempt = 0; attempt < 100; attempt++) {
        result = await service.execute("get_export_batch", { directory });
        if (!result.ok || !(result.value as { active: boolean }).active) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(result).toMatchObject({ ok: false, error: { code: "IO_ERROR" } });
    } finally {
      await chmod(directory, 0o700).catch(() => {});
      await service.batches.close();
      await service.jobs.close();
      await service.closeGraphicsPreview();
      await rm(root, { recursive: true, force: true });
    }
  },
);
