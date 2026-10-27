import { runExportBatch, type ActiveBatch } from "./export-batch-runner.js";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { lock } from "proper-lockfile";
import type { ExportBatchResult } from "../shared/export-batches.js";
import { loadGraphicResources } from "./graphic-resource-persistence.js";
import { validateProject } from "./project-schema.js";
import type { JobQueue } from "./job-queue.js";
import {
  batchFailure,
  batchHash,
  batchSnapshot,
  readBatchFile,
  readBatchRecord,
  readExportBatch,
  writeBatchRecord,
} from "./export-batch-store.js";

export class ExportBatchService {
  private active?: ActiveBatch;

  private starting = false;

  constructor(private readonly jobs: JobQueue) {}

  async read(directory: string): Promise<ExportBatchResult> {
    try {
      const path = await realpath(directory);
      const active = this.active;
      if (!active || active.directory !== path) return readExportBatch(path);
      const snapshot = batchSnapshot(active.record, path, true);
      if (active.job) {
        const job = this.jobs.read(active.job.id, active.job.sessionId);
        const queued = snapshot.entries.find(
          (entry) => entry.status === "running",
        );
        if (job.ok && job.value.status === "queued" && queued)
          queued.status = "queued";
        if (job.ok)
          snapshot.progress = Math.min(
            1,
            snapshot.progress +
              job.value.progress / active.record.entries.length,
          );
      }
      return { ok: true, value: snapshot };
    } catch (cause) {
      return batchFailure(cause);
    }
  }

  async resume(
    directory: string,
    batchId: string,
    retryInterrupted = false,
  ): Promise<ExportBatchResult> {
    if (this.active || this.starting)
      return {
        ok: false,
        error: {
          code: "CONFLICT",
          message: "Pause the active export batch before starting another",
        },
      };
    this.starting = true;
    let release: (() => Promise<void>) | undefined;
    let compromised = false;
    try {
      const path = await realpath(directory);
      release = await lock(path, {
        retries: 0,
        onCompromised: () => {
          compromised = true;
          this.stop();
        },
      });
      const record = await readBatchRecord(path);
      if (record.id !== batchId)
        return {
          ok: false,
          error: {
            code: "CONFLICT",
            message: "The export batch identity changed",
          },
        };
      if (
        !retryInterrupted &&
        record.entries.some(
          (entry) => !["pending", "completed"].includes(entry.status),
        )
      )
        return {
          ok: false,
          error: {
            code: "CONFLICT",
            message:
              "Explicitly retry interrupted, failed or cancelled outputs; completed outputs will be skipped",
          },
        };
      if (record.entries.every((entry) => entry.status === "completed"))
        return { ok: true, value: batchSnapshot(record, path, false) };
      const bytes = await readBatchFile(join(path, "project.forgecut"));
      if (batchHash(bytes) !== record.projectHash)
        return {
          ok: false,
          error: {
            code: "CONFLICT",
            message: "The captured batch project changed on disk",
          },
        };
      const project = validateProject(JSON.parse(bytes.toString("utf8")));
      await loadGraphicResources(project.resources ?? [], path);
      if (compromised)
        return {
          ok: false,
          error: {
            code: "CONFLICT",
            message: "The export batch lock was lost",
          },
        };
      const active: ActiveBatch = {
        directory: path,
        record,
        stopping: false,
        done: Promise.resolve(),
      };
      this.active = active;
      const unlock = release;
      release = undefined;
      active.done = runExportBatch(active, project, this.jobs)
        .catch(async (cause) => {
          const entry = record.entries.find(
            (candidate) => candidate.status === "running",
          );
          if (entry) {
            entry.status = "failed";
            entry.error = (
              cause instanceof Error ? cause.message : String(cause)
            ).slice(0, 4096);
            await writeBatchRecord(path, record).catch(() => {});
          }
        })
        .finally(async () => {
          this.active = undefined;
          await unlock().catch(() => {});
        });
      return { ok: true, value: batchSnapshot(record, path, true) };
    } catch (cause) {
      return batchFailure(cause);
    } finally {
      this.starting = false;
      if (release) await release().catch(() => {});
    }
  }

  async cancel(directory: string, batchId: string): Promise<ExportBatchResult> {
    const result = await this.read(directory);
    if (!result.ok) return result;
    if (result.value.id !== batchId)
      return {
        ok: false,
        error: {
          code: "CONFLICT",
          message: "The export batch identity changed",
        },
      };
    if (this.active?.directory === result.value.directory) this.stop();
    return this.read(directory);
  }

  async close(): Promise<void> {
    this.stop();
    await this.active?.done;
  }

  private stop(): void {
    if (!this.active) return;
    this.active.stopping = true;
    if (this.active.job)
      this.jobs.cancel(this.active.job.id, this.active.job.sessionId);
  }
}
