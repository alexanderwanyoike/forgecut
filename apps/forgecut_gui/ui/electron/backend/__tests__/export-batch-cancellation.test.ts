/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { ExportBatchSnapshot } from "../../shared/export-batches";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "pauses a queued batch, rejects a second owner and retries cancelled work in the same editor",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "forgecut-batch-pause-"));
    const directory = join(root, "outputs");
    const state = new AppState();
    const owner = new EditingService(state);
    const other = new EditingService(new AppState());
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = async () => {
      const result = await owner.execute("get_export_batch", { directory });
      if (!result.ok) throw new Error(result.error.message);
      return result.value as ExportBatchSnapshot;
    };
    async function wait(predicate: (batch: ExportBatchSnapshot) => boolean) {
      for (let attempt = 0; attempt < 500; attempt++) {
        const batch = await read();
        if (predicate(batch)) return batch;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("Batch pause workflow timed out");
    }
    try {
      await owner.execute("update_project", {
        settings: { width: 32, height: 18, fps: 10 },
      });
      await owner.execute("set_sequence_end", { endUs: 200000 });
      const created = await owner.execute("create_export_batch", {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        directory,
        sequenceIds: [state.project.default_sequence!.id],
      });
      if (!created.ok) throw new Error(created.error.message);
      const batch = created.value as ExportBatchSnapshot;
      owner.jobs.start(
        {
          sessionId: state.sessionId,
          projectRevision: state.revision,
          requestId: "held",
          kind: "frame",
          label: "Held media job",
          input: null,
        },
        async () => {
          await held;
          return { ok: true, value: null };
        },
      );
      expect(
        await owner.execute("resume_export_batch", {
          directory,
          batchId: batch.id,
        }),
      ).toMatchObject({ ok: true });
      await wait((current) => current.entries[0].status === "queued");
      expect(
        await other.execute("resume_export_batch", {
          directory,
          batchId: batch.id,
        }),
      ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(
        await owner.execute("cancel_export_batch", {
          directory,
          batchId: batch.id,
        }),
      ).toMatchObject({ ok: true });
      expect((await wait((current) => !current.active)).entries[0].status).toBe(
        "cancelled",
      );
      release();
      expect(
        await owner.execute("resume_export_batch", {
          directory,
          batchId: batch.id,
        }),
      ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(
        await owner.execute("resume_export_batch", {
          directory,
          batchId: batch.id,
          retryInterrupted: true,
        }),
      ).toMatchObject({ ok: true });
      expect((await wait((current) => !current.active)).entries[0].status).toBe(
        "completed",
      );
    } finally {
      release();
      await owner.batches.close();
      await other.batches.close();
      await owner.jobs.close();
      await other.jobs.close();
      await owner.closePreviews();
      await other.closePreviews();
      await rm(root, { recursive: true, force: true });
    }
  },
  15000,
);

it("does not begin rendering if shutdown starts while a batch is being resumed", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecut-batch-shutdown-"));
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
    const batch = created.value as ExportBatchSnapshot;
    const resuming = service.execute("resume_export_batch", {
      directory,
      batchId: batch.id,
    });
    await service.batches.close();
    expect(await resuming).toMatchObject({
      ok: false,
      error: { code: "QUEUE_CLOSED" },
    });
    expect(
      await service.execute("get_export_batch", { directory }),
    ).toMatchObject({
      ok: true,
      value: { active: false, entries: [{ status: "pending" }] },
    });
  } finally {
    await service.batches.close();
    await service.jobs.close();
    await service.closePreviews();
    await rm(root, { recursive: true, force: true });
  }
});

it("finishes shutdown during entry preparation without waiting for another media job", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecut-batch-preparing-"));
  const directory = join(root, "outputs");
  const state = new AppState();
  const service = new EditingService(state);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const created = await service.execute("create_export_batch", {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      directory,
      sequenceIds: [state.project.default_sequence!.id],
    });
    if (!created.ok) throw new Error(created.error.message);
    const batch = created.value as ExportBatchSnapshot;
    service.jobs.start(
      {
        sessionId: state.sessionId,
        projectRevision: state.revision,
        requestId: "other-media",
        kind: "frame",
        label: "Other media job",
        input: null,
      },
      async () => {
        await held;
        return { ok: true, value: null };
      },
    );
    expect(
      await service.execute("resume_export_batch", {
        directory,
        batchId: batch.id,
      }),
    ).toMatchObject({ ok: true });
    await Promise.race([
      service.batches.close(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error("Shutdown queued a render after the stop request"),
            ),
          2000,
        );
      }),
    ]);
    expect(
      await service.execute("get_export_batch", { directory }),
    ).toMatchObject({
      ok: true,
      value: { active: false, entries: [{ status: "cancelled" }] },
    });
  } finally {
    clearTimeout(timer);
    release();
    await service.batches.close();
    await service.jobs.close();
    await service.closePreviews();
    await rm(root, { recursive: true, force: true });
  }
});
