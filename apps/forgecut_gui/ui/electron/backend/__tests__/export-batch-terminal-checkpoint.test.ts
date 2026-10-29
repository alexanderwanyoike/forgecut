/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { watch, chmodSync } from "node:fs";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it.skipIf(
  process.platform === "win32" ||
    spawnSync("ffmpeg", ["-version"]).status !== 0,
)(
  "reports a checkpoint failure after publication while preserving the completed output",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "forgecut-batch-published-"));
    const directory = join(root, "outputs");
    const state = new AppState();
    const service = new EditingService(state);
    let watcher: ReturnType<typeof watch> | undefined;
    let published = false;
    try {
      await service.execute("update_project", {
        settings: { width: 32, height: 18, fps: 10 },
      });
      await service.execute("set_sequence_end", { endUs: 200000 });
      const created = await service.execute("create_export_batch", {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        directory,
        sequenceIds: [state.project.default_sequence!.id],
      });
      if (!created.ok) throw new Error(created.error.message);
      const batch = created.value as {
        id: string;
        entries: { outputFile: string }[];
      };
      watcher = watch(directory, (_, filename) => {
        if (filename?.toString() !== batch.entries[0].outputFile) return;
        published = true;
        chmodSync(directory, 0o500);
      });
      expect(
        await service.execute("resume_export_batch", {
          directory,
          batchId: batch.id,
        }),
      ).toMatchObject({ ok: true });
      let result = await service.execute("get_export_batch", { directory });
      for (let attempt = 0; attempt < 400; attempt++) {
        result = await service.execute("get_export_batch", { directory });
        if (!result.ok || !(result.value as { active: boolean }).active) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(published).toBe(true);
      expect(
        (await stat(join(directory, batch.entries[0].outputFile))).size,
      ).toBeGreaterThan(0);
      expect(result).toMatchObject({ ok: false, error: { code: "IO_ERROR" } });
    } finally {
      watcher?.close();
      await chmod(directory, 0o700).catch(() => {});
      await service.batches.close();
      await service.jobs.close();
      await service.closePreviews();
      await rm(root, { recursive: true, force: true });
    }
  },
  15000,
);
