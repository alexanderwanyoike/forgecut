import { z } from "zod";

export const resourceLicenseSchema = z.strictObject({
  identifier: z.string().min(1).max(256),
  text: z.string().min(1).max(65536),
  attribution: z.string().max(2048).optional(),
  source_url: z.url().max(2048).optional(),
});
export const graphicResourceSchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string().min(1).max(512),
    kind: z.enum(["Image", "Font"]),
    mime: z.enum([
      "image/png",
      "image/jpeg",
      "image/webp",
      "font/ttf",
      "font/otf",
      "font/woff",
      "font/woff2",
    ]),
    width: z.number().int().positive().max(8192).optional(),
    height: z.number().int().positive().max(8192).optional(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    path: z.string().regex(/^\.forgecut-resources\/[a-f0-9]{64}$/),
    license: resourceLicenseSchema,
  })
  .refine(
    (resource) =>
      resource.path === `.forgecut-resources/${resource.sha256}` &&
      resource.mime.startsWith(resource.kind === "Image" ? "image/" : "font/"),
    "Invalid resource identity or media type",
  );

const resourceImportFields = {
  path: z.string().min(1),
  kind: z.enum(["Image", "Font"]),
  target: z
    .strictObject({
      itemId: z.string().min(1).max(256),
      property: z.string().min(1).max(128),
      sessionId: z.string().min(1).max(256),
      expectedRevision: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER),
    })
    .optional(),
};
export const resourceImportSchema = z.union([
  z.strictObject({ ...resourceImportFields, license: resourceLicenseSchema }),
  z.strictObject({ ...resourceImportFields, licensePath: z.string().min(1) }),
]);
