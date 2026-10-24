import { z } from "zod";
import { idSchema } from "../backend/project-schema.js";
import { resourcePageFields } from "./page-schema.js";

export const stylePropertyPageFields = {
  ...resourcePageFields,
  presetId: idSchema,
  limit: z.number().int().min(1).max(5).default(5),
};
