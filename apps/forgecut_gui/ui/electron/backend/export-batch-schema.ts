import { isAbsolute } from "node:path";
import { z } from "zod";
import { EXPORT_PRESET_IDS } from "../shared/export-presets.js";
import { idSchema, timeSchema } from "./project-schema.js";

export const batchDirectorySchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(isAbsolute, "Use an absolute batch directory");
export const createExportBatchSchema = z.strictObject({
  sessionId: idSchema,
  expectedRevision: timeSchema,
  directory: batchDirectorySchema,
  sequenceIds: z
    .array(idSchema)
    .min(1)
    .max(32)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Choose each sequence once",
    ),
  preset: z.enum(EXPORT_PRESET_IDS).optional(),
});
export const exportBatchSchema = z
  .strictObject({
    version: z.literal(1),
    id: z.uuid(),
    projectName: z.string().max(512),
    projectRevision: timeSchema,
    projectHash: z.string().regex(/^[a-f0-9]{64}$/),
    entries: z
      .array(
        z.strictObject({
          id: z.uuid(),
          sequenceId: idSchema,
          name: z.string().max(512),
          preset: z.enum(EXPORT_PRESET_IDS),
          outputFile: z
            .string()
            .max(128)
            .regex(/^[a-z0-9_-]+\.(mp4|webm)$/i),
          status: z.enum([
            "pending",
            "running",
            "completed",
            "failed",
            "cancelled",
            "interrupted",
          ]),
          error: z.string().max(4096).optional(),
        }),
      )
      .min(1)
      .max(32),
  })
  .superRefine((record, context) => {
    const ids = new Set(record.entries.map((entry) => entry.id));
    const paths = new Set(
      record.entries.map((entry) => entry.outputFile.toLowerCase()),
    );
    const sequences = new Set(record.entries.map((entry) => entry.sequenceId));
    if (
      [ids.size, paths.size, sequences.size].some(
        (size) => size !== record.entries.length,
      )
    )
      context.addIssue({
        code: "custom",
        message:
          "Batch entry identities, sequences and output files must be unique",
      });
  });
export type ExportBatchRecord = z.infer<typeof exportBatchSchema>;
