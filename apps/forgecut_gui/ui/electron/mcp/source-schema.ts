import { z } from "zod";
import { graphicSourceSchema } from "../shared/graphic-source-schema.js";
import { idSchema, timeSchema } from "../backend/project-schema.js";

export const sourceCheckRequestSchema = z.strictObject({
  sessionId: idSchema,
  expectedRevision: timeSchema,
  requestId: idSchema,
  source: graphicSourceSchema,
});
