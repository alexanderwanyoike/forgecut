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
