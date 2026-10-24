import { z } from "zod";
import {
  exportRequestSchema,
  importRequestSchema,
  frameRequestSchema,
} from "./job-schema.js";
import {
  editSchemas,
  historyRequestSchema,
} from "../backend/command-schema.js";
import { MAX_MESSAGE_BYTES } from "./contract.js";

export const editingCapabilities = {
  schemaVersion: 1,
  timeUnit: "microseconds",
  limits: {
    operationsPerBatch: 100,
    itemsPerPage: 100,
    messageBytes: MAX_MESSAGE_BYTES,
  },
  history: z.toJSONSchema(historyRequestSchema),
  jobs: {
    export: z.toJSONSchema(exportRequestSchema),
    states: [
      "queued",
      "running",
      "cancelling",
      "committing",
      "completed",
      "failed",
      "cancelled",
    ],
    import: z.toJSONSchema(importRequestSchema),
    frame: z.toJSONSchema(frameRequestSchema),
    concurrency: 1,
    maxActive: 16,
    maxRetained: 64,
    retainedBytes: 8 * 1024 * 1024,
    timeoutMs: 120000,
  },
  operations: Object.fromEntries(
    Object.entries(editSchemas).map(([command, schema]) => [
      command,
      z.toJSONSchema(schema),
    ]),
  ),
};
