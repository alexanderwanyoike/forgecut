import { z } from "zod";
import { commandSchemas } from "../backend/command-schema.js";

export const batchActionSchemas = [
  commandSchemas.create_export_batch.extend({
    action: z.literal("create-batch"),
  }),
  commandSchemas.get_export_batch.extend({ action: z.literal("read-batch") }),
  commandSchemas.resume_export_batch.extend({
    action: z.literal("resume-batch"),
  }),
  commandSchemas.cancel_export_batch.extend({
    action: z.literal("cancel-batch"),
  }),
] as const;
export type BatchAction = z.infer<(typeof batchActionSchemas)[number]>;
