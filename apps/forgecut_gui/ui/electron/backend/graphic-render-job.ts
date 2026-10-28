import { z } from "zod";
import {
  graphicValuesSchema,
  graphicLayerStatesSchema,
} from "./graphic-schema.js";

export const graphicRenderJobSchema = z.strictObject({
  output: z.string().min(1),
  format: z.enum(["prores", "webm"]),
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

export function renderEncoding(
  job: Pick<GraphicRenderJob, "format" | "width" | "height">,
) {
  return job.format === "webm"
    ? {
        codec: "vp9" as const,
        pixelFormat: "yuva420p" as const,
        scale: previewScale(job.width, job.height),
      }
    : {
        codec: "prores" as const,
        proResProfile: "4444" as const,
        pixelFormat: "yuva444p10le" as const,
      };
}

/** Preview output stays within 960 pixels per side and 518400 pixels total. */
export function previewScale(width: number, height: number): number {
  return Math.min(
    1,
    960 / width,
    960 / height,
    Math.sqrt(518400 / (width * height)),
  );
}
