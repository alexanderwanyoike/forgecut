import { randomUUID } from "node:crypto";
import { startExportJob } from "../export-jobs.js";
import type { JobQueue } from "../job-queue.js";
import { EditingError } from "../editing-error.js";
import { requiredString, type CommandRegistry } from "./types.js";

export function exportCommands(jobs: JobQueue) {
  return {
    export_project: (args, {state, emit}) => {
      const result = startExportJob(state, jobs, {sessionId: state.sessionId, expectedRevision: state.revision, requestId: randomUUID(), outputPath: requiredString(args, "outputPath")}, progress => emit("export-progress", progress));
      if (!result.ok) throw new EditingError("IO_ERROR", result.error.message);
      return result.value;
    },
  } satisfies CommandRegistry;
}
