import { z } from "zod";
import { graphicComponentSchema } from "./graphic-schema.js";

export const graphicDraftSchema = z.strictObject({
  projectId: z.uuid(),
  itemId: z.uuid(),
  baseVersion: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  component: graphicComponentSchema,
});
