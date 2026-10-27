import type { ReviewRange } from "../shared/ipc-contract.js";
import type { AppState } from "./state.js";
import type { JobQueue } from "./job-queue.js";
import { exportProject } from "./exporter.js";
import type { Result } from "../shared/result.js";
import type { JobSnapshot, JobRequest } from "../shared/jobs.js";
import { projectForSequence } from "../domain/project-sequences.js";

type ExportRequest = {
  sessionId: string;
  expectedRevision: number;
  requestId: string;
  outputPath: string;
  sequenceId?: string;
  range?: ReviewRange;
};

export function startExportJob(
  state: AppState,
  jobs: JobQueue,
  request: ExportRequest,
): Result<JobSnapshot> {
  if (state.sessionId !== request.sessionId)
    return {
      ok: false,
      error: {
        code: "PROJECT_CHANGED",
        message: "The project session changed.",
      },
    };
  const sequenceId =
    request.sequenceId ??
    state.project.default_sequence?.id ??
    state.project.id;
  const range = request.range ? { ...request.range } : undefined;
  const { outputPath } = request;
  const job: JobRequest = {
    sessionId: request.sessionId,
    projectRevision: request.expectedRevision,
    requestId: request.requestId,
    kind: "export",
    label: "Export project",
    input: { outputPath, sequenceId, ...(range ? { range } : {}) },
  };
  const replayed = jobs.replay(job);
  if (!replayed.ok) return replayed;
  if (replayed.value) return { ok: true, value: replayed.value };
  if (!request.sequenceId && (state.project.sequences?.length ?? 0) > 0)
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message:
          "Provide a sequence ID before exporting a multi-sequence project",
      },
    };
  const selected = projectForSequence(state.project, sequenceId);
  if (!selected.ok) return selected;
  // AppState publishes frozen replacements, so the queued view keeps this revision.
  const snapshot = selected.value;
  const { revision } = state;
  return jobs.start(job, async (signal, report, beginCommit) => {
    if (revision !== request.expectedRevision)
      return {
        ok: false,
        error: {
          code: "CONFLICT",
          message: "Read the current project revision before exporting.",
        },
      };
    return exportProject(snapshot, outputPath, {
      range,
      signal,
      beginCommit,
      onProgress: (progress) => {
        report(progress.percent / 100);
      },
    });
  });
}
