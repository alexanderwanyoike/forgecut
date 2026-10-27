import type { ExportPresetId } from "./export-presets.js";
import type { Result } from "./result.js";

export type ExportBatchEntry = {
  id: string;
  sequenceId: string;
  name: string;
  preset: ExportPresetId;
  outputFile: string;
  status:
    | "queued"
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  error?: string;
};
export type ExportBatchSnapshot = {
  id: string;
  directory: string;
  projectName: string;
  projectRevision: number;
  entries: ExportBatchEntry[];
  active: boolean;
  progress: number;
};
export type ExportBatchResult<T = ExportBatchSnapshot> = Result<
  T,
  {
    code: "INVALID_INPUT" | "CONFLICT" | "PROJECT_CHANGED" | "IO_ERROR";
    message: string;
  }
>;
export type CreateExportBatch = {
  sessionId: string;
  expectedRevision: number;
  directory: string;
  sequenceIds: string[];
  preset?: ExportPresetId;
};
