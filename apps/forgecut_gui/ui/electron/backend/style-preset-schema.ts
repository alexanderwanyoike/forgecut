import { z } from "zod";
import { graphicValuesSchema } from "./graphic-schema.js";

export const stylePresetSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  purpose: z.enum(["card", "ending"]),
  component_id: z.uuid(),
  component_version: z.string().regex(/^[a-f0-9]{64}$/),
  props: graphicValuesSchema,
});
