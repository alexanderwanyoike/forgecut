import { z } from "zod";
import { idSchema, timeSchema } from "../backend/project-schema.js";
import { pageFields } from "./page-schema.js";

export const sequencePageFields = {
  ...pageFields,
  sequenceId: idSchema.optional(),
};
export const sequenceSelectionSchema = z.strictObject({
  sessionId: idSchema,
  sequenceId: idSchema,
  expectedSequenceRevision: timeSchema,
});
export const sequenceActionSchemas = [
  z.strictObject({ action: z.literal("sequences"), ...pageFields }),
  sequenceSelectionSchema.extend({ action: z.literal("select-sequence") }),
  z.strictObject({
    action: z.literal("sequence"),
    ...sequencePageFields,
    playheadUs: timeSchema,
  }),
  z.strictObject({
    action: z.literal("timeline"),
    ...sequencePageFields,
    startUs: timeSchema,
    endUs: timeSchema,
  }),
  z.strictObject({
    action: z.literal("item"),
    sessionId: idSchema,
    sequenceId: idSchema.optional(),
    itemId: idSchema,
  }),
] as const;
export type SequenceAction = z.infer<(typeof sequenceActionSchemas)[number]>;
