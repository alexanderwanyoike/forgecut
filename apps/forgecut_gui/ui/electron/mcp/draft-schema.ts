import { z } from "zod";
import {
  graphicSourceFileNameSchema,
  graphicSourceSchema,
} from "../shared/graphic-source-schema.js";
import { commandSchemas } from "../backend/command-schema.js";
import { idSchema } from "../backend/project-schema.js";

export const sourceReadSchema = z.strictObject({
  sessionId: idSchema,
  itemId: idSchema,
  view: z.enum(["active", "draft"]).default("draft"),
  file: graphicSourceFileNameSchema.optional(),
  includeMetadata: z.boolean().default(false),
});
export const draftFileSchema = commandSchemas.save_graphic_draft
  .omit({ component: true })
  .extend({
    path: graphicSourceFileNameSchema,
    content: graphicSourceSchema.shape.files.valueType.optional(),
    remove: z.boolean().optional(),
  });
export const sourceActionSchemas = [
  sourceReadSchema.extend({ action: z.literal("source-read") }),
  draftFileSchema.extend({ action: z.literal("draft-file") }),
  commandSchemas.save_graphic_draft.extend({ action: z.literal("draft-save") }),
  commandSchemas.revert_graphic_draft.extend({
    action: z.literal("draft-revert"),
  }),
  commandSchemas.start_graphic_promotion.extend({
    action: z.literal("source-promote"),
  }),
] as const;
export type SourceAction = z.infer<(typeof sourceActionSchemas)[number]>;
