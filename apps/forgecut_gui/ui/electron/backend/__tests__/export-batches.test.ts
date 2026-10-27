/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  mkdir,
  writeFile,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { ExportBatchSnapshot } from "../../shared/export-batches";
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

it.skipIf(
  ["ffmpeg", "ffprobe"].some(
    (tool) => spawnSync(tool, ["-version"]).status !== 0,
  ),
)(
  "exports captured sequences serially and skips completed outputs on resume",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "forgecut-batch-render-"));
    const directory = join(root, "outputs");
    const state = new AppState();
    const service = new EditingService(state);
    try {
      await service.execute("update_project", {
        settings: { width: 32, height: 18, fps: 10 },
      });
      await service.execute("set_sequence_end", { endUs: 200000 });
      await service.execute("create_sequence", {
        name: "Portrait",
        settings: { width: 18, height: 32 },
      });
      const ids = [
        state.project.default_sequence!.id,
        state.project.sequences![0].id,
      ];
      await service.execute(
        "set_sequence_end",
        { endUs: 200000 },
        { sequenceId: ids[1] },
      );
      const created = await service.execute("create_export_batch", {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        directory,
        sequenceIds: ids,
      });
      expect(created).toMatchObject({ ok: true });
      if (!created.ok) throw new Error(created.error.message);
      const batch = created.value as ExportBatchSnapshot;
      await service.execute("update_project", {
        name: "Manual edit after capture",
        settings: { width: 64, height: 36 },
      });
      const before = state.snapshot();
      expect(
        await service.execute("resume_export_batch", {
          directory,
          batchId: batch.id,
        }),
      ).toMatchObject({ ok: true });
      let finished = batch;
      for (let attempt = 0; attempt < 500; attempt++) {
        const read = await service.execute("get_export_batch", { directory });
        if (!read.ok) throw new Error(read.error.message);
        finished = read.value as ExportBatchSnapshot;
        if (!finished.active) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(finished).toMatchObject({
        active: false,
        progress: 1,
        entries: [{ status: "completed" }, { status: "completed" }],
      });
      for (const [index, entry] of finished.entries.entries()) {
        const result = spawnSync(
          "ffprobe",
          [
            "-v",
            "error",
            "-count_frames",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,nb_read_frames",
            "-of",
            "json",
            join(directory, entry.outputFile),
          ],
          { encoding: "utf8" },
        );
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout).streams[0]).toMatchObject({
          width: index ? 18 : 32,
          height: index ? 32 : 18,
          nb_read_frames: "2",
        });
      }
      const first = join(directory, finished.entries[0].outputFile);
      await utimes(first, 1000, 1000);
      expect(
        await service.execute("resume_export_batch", {
          directory,
          batchId: batch.id,
        }),
      ).toMatchObject({ ok: true, value: { active: false, progress: 1 } });
      expect((await stat(first)).mtimeMs).toBe(1000000);
      expect(state.snapshot()).toEqual(before);
    } finally {
      await service.batches?.close();
      await service.jobs.close();
      await service.closeGraphicsPreview();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "requires an explicit restart retry and removes only the interrupted entry's partial directory",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "forgecut-batch-recovery-"));
    const directory = join(root, "outputs");
    const state = new AppState();
    const original = new EditingService(state);
    const recovered = new EditingService(new AppState());
    try {
      await original.execute("update_project", {
        settings: { width: 32, height: 18, fps: 10 },
      });
      await original.execute("set_sequence_end", { endUs: 200000 });
      const created = await original.execute("create_export_batch", {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        directory,
        sequenceIds: [state.project.default_sequence!.id],
      });
      if (!created.ok) throw new Error(created.error.message);
      const batch = created.value as ExportBatchSnapshot;
      const manifestPath = join(directory, "batch.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.entries[0].status = "running";
      await writeFile(manifestPath, JSON.stringify(manifest));
      const partial = join(
        directory,
        `.forgecut-export-${batch.entries[0].id}`,
      );
      await mkdir(partial);
      await writeFile(join(partial, "partial.mp4"), "Interrupted render");
      const unrelated = join(directory, ".forgecut-export-unrelated");
      await mkdir(unrelated);
      await writeFile(join(unrelated, "keep"), "Keep this file");
      await original.batches.close();
      await original.jobs.close();
      expect(
        await recovered.execute("get_export_batch", { directory }),
      ).toMatchObject({
        ok: true,
        value: { active: false, entries: [{ status: "interrupted" }] },
      });
      expect(
        await recovered.execute("resume_export_batch", {
          directory,
          batchId: batch.id,
        }),
      ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(
        await recovered.execute("resume_export_batch", {
          directory,
          batchId: batch.id,
          retryInterrupted: true,
        }),
      ).toMatchObject({ ok: true });
      let result = batch;
      for (let attempt = 0; attempt < 500; attempt++) {
        const read = await recovered.execute("get_export_batch", { directory });
        if (!read.ok) throw new Error(read.error.message);
        result = read.value as ExportBatchSnapshot;
        if (!result.active) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(result.entries[0].status).toBe("completed");
      await expect(access(partial)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(unrelated, "keep"), "utf8")).toBe(
        "Keep this file",
      );
    } finally {
      await original.batches.close();
      await recovered.batches.close();
      await original.jobs.close();
      await recovered.jobs.close();
      await original.closeGraphicsPreview();
      await recovered.closeGraphicsPreview();
      await rm(root, { recursive: true, force: true });
    }
  },
);
