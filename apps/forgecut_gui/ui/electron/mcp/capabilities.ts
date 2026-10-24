import { z } from "zod";
import { sourceReadSchema, draftFileSchema } from "./draft-schema.js";
import {
  commandSchemas,
  editSchemas,
  historyRequestSchema,
} from "../backend/command-schema.js";
import { graphicPackages } from "../shared/graphic-source.js";
import { sourceCheckRequestSchema } from "./source-schema.js";
import {
  resourceRequestSchema,
  exportRequestSchema,
  importRequestSchema,
  frameRequestSchema,
} from "./job-schema.js";
import { MAX_MESSAGE_BYTES } from "./contract.js";

export const editingCapabilities = {
  schemaVersion: 1,
  timeUnit: "microseconds",
  limits: {
    operationsPerBatch: 100,
    itemsPerPage: 100,
    graphicResourcesPerPage: 20,
    graphicResourceBytes: 8 * 1024 * 1024,
    messageBytes: MAX_MESSAGE_BYTES,
  },
  sourceDrafts: {
    read: z.toJSONSchema(sourceReadSchema),
    patchFile: z.toJSONSchema(draftFileSchema),
    save: z.toJSONSchema(commandSchemas.save_graphic_draft),
    revert: z.toJSONSchema(commandSchemas.revert_graphic_draft),
    promote: z.toJSONSchema(commandSchemas.start_graphic_promotion),
    defaultScope: "instance",
    requiresLinuxExecutionBoundary: true,
  },
  sourceChecks: {
    request: z.toJSONSchema(sourceCheckRequestSchema),
    packages: graphicPackages,
    maxFiles: 32,
    maxSourceBytes: 524288,
    timeoutMs: 15000,
  },
  history: z.toJSONSchema(historyRequestSchema),
  jobs: {
    resourceImport: z.toJSONSchema(resourceRequestSchema),
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
    exportTimeoutMs: 900000,
  },
  operations: Object.fromEntries(
    Object.entries(editSchemas).map(([command, schema]) => [
      command,
      z.toJSONSchema(schema),
    ]),
  ),
};
