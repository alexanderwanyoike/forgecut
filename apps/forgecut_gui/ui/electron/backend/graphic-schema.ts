import {
  graphicPropertyNameSchema as key,
  graphicPropertiesSchema,
} from "../shared/graphic-property-schema.js";
import { z } from "zod";
import { graphicSourceSchema } from "../shared/graphic-source-schema.js";

export const graphicValueSchema = z.union([
  z.string().max(32768),
  z.number(),
  z.boolean(),
  z.null(),
]);
export const graphicValuesSchema = z.record(
  z.string().min(1).max(128),
  graphicValueSchema,
);
export const graphicComponentSchema = z.strictObject({
  id: z.uuid(),
  template_id: key,
  version: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().min(1).max(256),
  design_size: z.strictObject({
    width: z.number().positive().int().max(16384),
    height: z.number().positive().int().max(16384),
  }),
  source: graphicSourceSchema,
  dependencies: z.strictObject({
    packages: z.record(key, z.string().min(1).max(128)),
    assets: z.array(z.string()).max(100),
    fonts: z.array(z.string()).max(100),
  }),
  properties: graphicPropertiesSchema,
  layers: z
    .array(
      z.discriminatedUnion("kind", [
        z.strictObject({
          id: z.uuid(),
          name: key,
          label: z.string().min(1).max(256),
          kind: z.literal("text"),
          bindings: z.strictObject({
            x: key,
            y: key,
            width: key,
            height: key,
            opacity: key,
            text: key,
            color: key,
            font_size: key,
            font: key.optional(),
            alignment: key.optional(),
            animation: key.optional(),
            entrance_frames: key.optional(),
          }),
        }),
        z.strictObject({
          id: z.uuid(),
          name: key,
          label: z.string().min(1).max(256),
          kind: z.literal("image"),
          bindings: z.strictObject({
            x: key,
            y: key,
            width: key,
            height: key,
            opacity: key,
            image: key,
            fit: key,
          }),
        }),
      ]),
    )
    .max(100),
});

export const graphicLayerStatesSchema = z
  .record(
    z.uuid(),
    z.strictObject({
      hidden: z.boolean().optional(),
      locked: z.boolean().optional(),
      order: z.number().int().min(-10000).max(10000).optional(),
    }),
  )
  .refine((states) => Object.keys(states).length <= 100);
