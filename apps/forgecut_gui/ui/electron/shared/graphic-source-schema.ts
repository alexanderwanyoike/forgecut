import { z } from "zod";

export const graphicSourceFileNameSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-z\d_.-]+(?:\/[a-z\d_.-]+)*$/i)
  .refine((path) =>
    path.split("/").every((part) => part !== ".." && part !== "."),
  );

export const graphicSourceSchema = z.strictObject({
  entry: graphicSourceFileNameSchema,
  files: z
    .record(
      graphicSourceFileNameSchema,
      z
        .string()
        .max(131072)
        .refine(
          (content) => new TextEncoder().encode(content).byteLength <= 131072,
          "Source file exceeds 128 KiB",
        ),
    )
    .refine(
      (files) =>
        Object.keys(files).length > 0 &&
        Object.keys(files).length <= 32 &&
        Object.values(files).reduce(
          (sum, content) => sum + new TextEncoder().encode(content).byteLength,
          0,
        ) <= 524288,
    ),
});
