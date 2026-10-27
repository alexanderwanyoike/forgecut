import type { CommandMap } from "../../shared/ipc-contract.js";
import { createExportBatch, readExportBatch } from "../export-batch-store.js";
import type { ExportBatchResult } from "../../shared/export-batches.js";
import { EditingError } from "../editing-error.js";
import { requiredString, type CommandRegistry } from "./types.js";

async function unwrap(result: Promise<ExportBatchResult>) {
  const response = await result;
  if (!response.ok)
    throw new EditingError(response.error.code, response.error.message);
  return response.value;
}
export const exportBatchCommands = {
  create_export_batch: (args, { state }) =>
    unwrap(
      createExportBatch(
        state,
        args as CommandMap["create_export_batch"]["args"],
      ),
    ),
  get_export_batch: (args) =>
    unwrap(readExportBatch(requiredString(args, "directory"))),
} satisfies CommandRegistry;
