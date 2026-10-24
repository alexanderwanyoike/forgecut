import { isAbsolute } from "node:path";
import { z } from "zod";
import { resourceImportSchema } from "../backend/graphic-resource-schema.js";
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
    sequenceId: idSchema.optional(),
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

const selection = z
  .strictObject({ itemId: idSchema, property: z.string().min(1).max(128) })
  .optional();
const [inlineLicense, fileLicense] = resourceImportSchema.options;
export const resourceRequestSchema = importRequestSchema
  .omit({ paths: true })
  .extend({
    resource: z
      .union([
        inlineLicense.extend({ target: selection }),
        fileLicense.extend({ target: selection }),
      ])
      .superRefine((resource, context) => {
        if (!isAbsolute(resource.path))
          context.addIssue({
            code: "custom",
            path: ["path"],
            message: "Use an absolute resource path",
          });
        if ("licensePath" in resource && !isAbsolute(resource.licensePath))
          context.addIssue({
            code: "custom",
            path: ["licensePath"],
            message: "Use an absolute licence path",
          });
      }),
  });
