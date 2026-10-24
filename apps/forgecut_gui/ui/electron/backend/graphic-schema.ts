import { z } from "zod";

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
const key = z
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
const fileName = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-z\d_.-]+(?:\/[a-z\d_.-]+)*$/i)
  .refine((path) =>
    path.split("/").every((part) => part !== ".." && part !== "."),
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
  source: z.strictObject({
    entry: fileName,
    files: z
      .record(fileName, z.string().max(131072))
      .refine(
        (files) =>
          Object.keys(files).length > 0 &&
          Object.keys(files).length <= 32 &&
          Object.values(files).reduce(
            (sum, content) => sum + Buffer.byteLength(content),
            0,
          ) <= 524288,
      ),
  }),
  dependencies: z.strictObject({
    packages: z.record(key, z.string().min(1).max(128)),
    assets: z.array(z.string()).max(100),
    fonts: z.array(z.string()).max(100),
  }),
  properties: z
    .record(key, property)
    .refine((properties) => Object.keys(properties).length <= 100),
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
