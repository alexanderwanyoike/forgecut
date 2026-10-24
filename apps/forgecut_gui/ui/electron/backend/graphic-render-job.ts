import { z } from "zod";
import {
  graphicValuesSchema,
  graphicLayerStatesSchema,
} from "./graphic-schema.js";

export const graphicRenderJobSchema = z.strictObject({
  output: z.string().min(1),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  code: z.string().min(1).max(2097152).optional(),
  width: z.number().int().positive().max(16384),
  height: z.number().int().positive().max(16384),
  fps: z.number().positive().max(240),
  duration: z.number().int().positive(),
  renderFrames: z.number().int().positive(),
  values: graphicValuesSchema,
  layerStates: graphicLayerStatesSchema.optional(),
  resources: z
    .record(
      z.string().max(256),
      z.strictObject({
        url: z
          .string()
          .max(12 * 1024 * 1024)
          .startsWith("data:"),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        mime: z.enum([
          "image/png",
          "image/jpeg",
          "image/webp",
          "font/ttf",
          "font/otf",
          "font/woff",
          "font/woff2",
        ]),
      }),
    )
    .refine(
      (resources) =>
        Object.values(resources).reduce(
          (sum, resource) => sum + resource.url.length,
          0,
        ) <=
        24 * 1024 * 1024,
    ),
});
export type GraphicRenderJob = z.infer<typeof graphicRenderJobSchema>;
