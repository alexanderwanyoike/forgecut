import { z } from "zod";
import { graphicRenderJobSchema } from "./graphic-render-job.js";
import {
  graphicValuesSchema,
  graphicLayerStatesSchema,
} from "./graphic-schema.js";

export const previewInputSchema = graphicRenderJobSchema
  .pick({
    code: true,
    resources: true,
    values: true,
    layerStates: true,
    width: true,
    height: true,
    fps: true,
    duration: true,
  })
  .extend({
    key: z.string().regex(/^[a-f0-9]{64}$/),
    code: z.string().min(1).max(2097152),
    frame: z.number().int().nonnegative(),
  });
export const previewCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("load"),
    id: z.number().int(),
    input: previewInputSchema,
  }),
  z.strictObject({
    kind: z.literal("frame"),
    id: z.number().int(),
    key: z.string(),
    frame: z.number().int().nonnegative(),
    values: graphicValuesSchema,
    layerStates: graphicLayerStatesSchema.optional(),
  }),
]);
export const previewResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), id: z.number().int(), value: z.unknown() }),
  z.object({
    ok: z.literal(false),
    id: z.number().int(),
    error: z.object({ code: z.string(), message: z.string().max(8192) }),
  }),
]);
export const previewFrameSchema = z.strictObject({
  mimeType: z.literal("image/png"),
  data: z.string().max(4194304),
  width: z.number().int().positive().max(960),
  height: z.number().int().positive().max(960),
});
