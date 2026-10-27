import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Project } from "../shared/ipc-contract.js";
import type { JobSnapshot } from "../shared/jobs.js";
import { projectForSequence } from "../domain/project-sequences.js";
import type { JobQueue } from "./job-queue.js";
import type { ExportBatchRecord } from "./export-batch-schema.js";
import { writeBatchRecord } from "./export-batch-store.js";
import { batchStagePath } from "./export-staging.js";
import { exportProject } from "./exporter.js";

export type ActiveBatch = {
  directory: string;
  record: ExportBatchRecord;
  stopping: boolean;
  done: Promise<void>;
  job?: JobSnapshot;
};

export async function runExportBatch(
  active: ActiveBatch,
  project: Project,
  jobs: JobQueue,
): Promise<void> {
  for (const entry of active.record.entries) {
    if (active.stopping) break;
    if (entry.status === "completed") continue;
    entry.status = "running";
    delete entry.error;
    await writeBatchRecord(active.directory, active.record);
    await rm(batchStagePath(active.directory, entry.id), {
      recursive: true,
      force: true,
    });
    const selected = projectForSequence(project, entry.sequenceId);
    if (!selected.ok) throw new Error(selected.error.message);
    const started = jobs.start(
      {
        sessionId: active.record.id,
        projectRevision: active.record.projectRevision,
        requestId: randomUUID(),
        kind: "export",
        label: `Export ${entry.name}`,
        input: {
          projectHash: active.record.projectHash,
          outputFile: entry.outputFile,
          stagingId: entry.id,
          preset: entry.preset,
        },
      },
      (signal, report, beginCommit) =>
        exportProject(
          selected.value,
          join(active.directory, entry.outputFile),
          {
            stagingId: entry.id,
            preset: entry.preset,
            signal,
            beginCommit,
            onProgress: (progress) => report(progress.percent / 100),
          },
        ),
    );
    if (!started.ok) throw new Error(started.error.message);
    active.job = started.value;
    let job = started.value;
    while (
      ["queued", "running", "cancelling", "committing"].includes(job.status)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const next = jobs.read(job.id, job.sessionId);
      if (!next.ok) throw new Error(next.error.message);
      job = next.value;
    }
    active.job = undefined;
    entry.status =
      job.status === "completed"
        ? "completed"
        : job.status === "cancelled"
          ? "cancelled"
          : "failed";
    if (job.result && !job.result.ok)
      entry.error = job.result.error.message.slice(0, 4096);
    await writeBatchRecord(active.directory, active.record);
    if (entry.status !== "completed") break;
  }
}
