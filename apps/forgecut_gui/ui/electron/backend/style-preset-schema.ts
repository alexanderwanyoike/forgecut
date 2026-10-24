import { visualPlacementSchema } from "../shared/visual-placement-schema.js";
import { z } from "zod";
import {
  graphicValuesSchema,
  graphicLayerStatesSchema,
} from "./graphic-schema.js";

export const stylePresetSchema = z.strictObject({
  canvas_size: z.strictObject({
    width: z.number().int().positive().max(16384),
    height: z.number().int().positive().max(16384),
  }),
  layer_states: graphicLayerStatesSchema.optional(),
  transform: visualPlacementSchema.optional(),
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  purpose: z.enum(["card", "ending"]),
  component_id: z.uuid(),
  component_version: z.string().regex(/^[a-f0-9]{64}$/),
  props: graphicValuesSchema,
});
