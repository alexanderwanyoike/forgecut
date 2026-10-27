import type { ExportBatchService } from "../ExportBatchService.js";
import type { CommandMap } from "../../shared/ipc-contract.js";
import { createExportBatch } from "../export-batch-store.js";
import type { ExportBatchResult } from "../../shared/export-batches.js";
import { EditingError } from "../editing-error.js";
import { requiredString, type CommandRegistry } from "./types.js";

async function unwrap(result: Promise<ExportBatchResult>) {
  const response = await result;
  if (!response.ok)
    throw new EditingError(response.error.code, response.error.message);
  return response.value;
}
export function exportBatchCommands(batches: ExportBatchService) {
  return {
    create_export_batch: (args, { state }) =>
      unwrap(
        createExportBatch(
          state,
          args as CommandMap["create_export_batch"]["args"],
        ),
      ),
    get_export_batch: (args) =>
      unwrap(batches.read(requiredString(args, "directory"))),
    resume_export_batch: (args) =>
      unwrap(
        batches.resume(
          requiredString(args, "directory"),
          requiredString(args, "batchId"),
          args?.retryInterrupted === true,
        ),
      ),
    cancel_export_batch: (args) =>
      unwrap(
        batches.cancel(
          requiredString(args, "directory"),
          requiredString(args, "batchId"),
        ),
      ),
  } satisfies CommandRegistry;
}
