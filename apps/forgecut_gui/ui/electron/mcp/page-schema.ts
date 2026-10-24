import { z } from "zod";
import { idSchema, timeSchema } from "../backend/project-schema.js";

export const pageFields = {
  sessionId: idSchema,
  offset: timeSchema.default(0),
  limit: z.number().int().min(1).max(100).default(50),
};
export const resourcePageFields = {
  ...pageFields,
  limit: z.number().int().min(1).max(20).default(10),
};
