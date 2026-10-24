import type { AppState } from "./state.js";
import type { JobQueue } from "./job-queue.js";
import { exportProject } from "./exporter.js";
import type { Result } from "../shared/result.js";
import type { JobSnapshot } from "../shared/jobs.js";

type ExportRequest = {
  sessionId: string;
  expectedRevision: number;
  requestId: string;
  outputPath: string;
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
  // AppState publishes frozen replacements, so the queued job keeps this exact revision.
  const snapshot = state.project;
  const { revision } = state;
  return jobs.start(
    {
      sessionId: request.sessionId,
      projectRevision: request.expectedRevision,
      requestId: request.requestId,
      kind: "export",
      label: "Export project",
      input: request.outputPath,
    },
    async (signal, report, beginCommit) => {
      if (revision !== request.expectedRevision)
        return {
          ok: false,
          error: {
            code: "CONFLICT",
            message: "Read the current project revision before exporting.",
          },
        };
      return exportProject(snapshot, request.outputPath, {
        signal,
        beginCommit,
        onProgress: (progress) => {
          report(progress.percent / 100);
        },
      });
    },
  );
}
