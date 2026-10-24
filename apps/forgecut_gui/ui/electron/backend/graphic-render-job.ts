import { z } from "zod";
import { graphicValuesSchema } from "./graphic-schema.js";

export const graphicRenderJobSchema = z.strictObject({
  output: z.string().min(1),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().max(16384),
  height: z.number().int().positive().max(16384),
  fps: z.number().positive().max(240),
  duration: z.number().int().positive(),
  renderFrames: z.number().int().positive(),
  values: graphicValuesSchema,
});
export type GraphicRenderJob = z.infer<typeof graphicRenderJobSchema>;
