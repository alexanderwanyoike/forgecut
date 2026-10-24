import { isAbsolute } from "node:path";
import { z } from "zod";
import { idSchema, timeSchema } from "../backend/project-schema.js";

export const importRequestSchema = z.strictObject({
  sessionId: idSchema,
  expectedRevision: timeSchema,
  requestId: idSchema,
  paths: z
    .array(
      z
        .string()
        .min(1)
        .max(4096)
        .refine(isAbsolute, "Use absolute media paths"),
    )
    .min(1)
    .max(32),
});
export const jobRequestSchema = z.strictObject({
  sessionId: idSchema,
  jobId: z.uuid(),
});
export const exportRequestSchema = importRequestSchema
  .omit({ paths: true })
  .extend({
    outputPath: z
      .string()
      .min(1)
      .max(4096)
      .refine(isAbsolute, "Use an absolute output path"),
  });
export const frameRequestSchema = importRequestSchema
  .omit({ paths: true })
  .extend({ assetId: idSchema, timeUs: timeSchema });
export const frameJobSchema = z.looseObject({
  kind: z.literal("frame"),
  result: z.strictObject({
    ok: z.literal(true),
    value: z.strictObject({
      mimeType: z.literal("image/jpeg"),
      data: z.string().max(700000),
    }),
  }),
});
