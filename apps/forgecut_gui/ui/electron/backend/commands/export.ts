import { randomUUID } from "node:crypto";
import type { CommandMap } from "../../shared/ipc-contract.js";
import { startExportJob } from "../export-jobs.js";
import type { JobQueue } from "../job-queue.js";
import { EditingError } from "../editing-error.js";
import { requiredString, type CommandRegistry } from "./types.js";

export function exportCommands(jobs: JobQueue) {
  return {
    cancel_media_job: (args) => {
      const result = jobs.cancel(
        requiredString(args, "jobId"),
        requiredString(args, "sessionId"),
      );
      if (!result.ok) {
        let code: "COMMITTING" | "PROJECT_CHANGED" | "NOT_FOUND" = "NOT_FOUND";
        if (
          result.error.code === "COMMITTING" ||
          result.error.code === "PROJECT_CHANGED"
        )
          code = result.error.code;
        throw new EditingError(code, result.error.message);
      }
      return result.value;
    },
    get_media_job: (args) => {
      const result = jobs.read(
        requiredString(args, "jobId"),
        requiredString(args, "sessionId"),
      );
      if (!result.ok)
        throw new EditingError(
          result.error.code === "PROJECT_CHANGED"
            ? "PROJECT_CHANGED"
            : "NOT_FOUND",
          result.error.message,
        );
      return result.value;
    },
    export_project: (args, { state, sequenceId }) => {
      const input = args as CommandMap["export_project"]["args"];
      const result = startExportJob(state, jobs, {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: randomUUID(),
        outputPath: requiredString(args, "outputPath"),
        range: input.range,
        sequenceId:
          typeof args?.sequenceId === "string" ? args.sequenceId : sequenceId,
      });
      if (!result.ok)
        throw new EditingError(
          result.error.code === "INVALID_INPUT" ||
            result.error.code === "NOT_FOUND"
            ? result.error.code
            : "IO_ERROR",
          result.error.message,
        );
      return result.value;
    },
  } satisfies CommandRegistry;
}
