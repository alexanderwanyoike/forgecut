import { z } from "zod";

export const graphicPropertyNameSchema = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (value) => !["__proto__", "constructor", "prototype"].includes(value),
  );
const propertyBase = { id: z.uuid(), label: z.string().min(1).max(256) };
const property = z.discriminatedUnion("type", [
  z.strictObject({
    ...propertyBase,
    type: z.enum(["text", "font", "image"]),
    default: z.string().max(32768),
  }),
  z.strictObject({
    ...propertyBase,
    type: z.literal("color"),
    default: z.string().regex(/^#[\da-f]{6}([\da-f]{2})?$/i),
  }),
  z.strictObject({
    ...propertyBase,
    type: z.literal("number"),
    default: z.number(),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.strictObject({
    ...propertyBase,
    type: z.literal("select"),
    default: z.string().max(256),
    options: z
      .array(
        z.strictObject({
          value: z.string().min(1).max(256),
          label: z.string().min(1).max(256),
        }),
      )
      .min(1)
      .max(32),
  }),
  z.strictObject({
    ...propertyBase,
    type: z.literal("boolean"),
    default: z.boolean(),
  }),
]);

export const graphicPropertiesSchema = z
  .record(graphicPropertyNameSchema, property)
  .refine((properties) => Object.keys(properties).length <= 100);
