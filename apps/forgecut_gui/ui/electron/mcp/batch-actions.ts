import type { EditingService } from "../backend/editing-service.js";
import type { BridgeResult } from "./contract.js";
import type { BatchAction } from "./batch-schema.js";

export async function dispatchBatchAction(
  service: EditingService,
  request: BatchAction,
): Promise<BridgeResult> {
  const { action, ...args } = request;
  const command = {
    "create-batch": "create_export_batch",
    "read-batch": "get_export_batch",
    "resume-batch": "resume_export_batch",
    "cancel-batch": "cancel_export_batch",
  }[action];
  const response = await service.execute(command, args);
  return response.ok ? { ok: true, value: response.value } : response;
}
