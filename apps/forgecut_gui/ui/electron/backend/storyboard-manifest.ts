import { z } from "zod";

export const storyboardMediaPath =
  /^shots\/[0-9]{4,}\/(image|end_frame|video)\.(png|jpe?g|webp|gif|mp4|mov|mkv|webm)$/;
export const storyboardManifestSchema = z.object({
  format: z.literal("showbiz-storyboard"),
  version: z.literal(1),
  storyboard: z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(1000),
  }),
  shots: z
    .array(
      z.object({
        id: z.string().min(1),
        order: z.number().int().nonnegative(),
        duration: z.number().finite().nonnegative(),
        media: z
          .array(
            z.object({
              role: z.enum(["image", "end_frame", "video"]),
              path: z.string().regex(storyboardMediaPath),
            }),
          )
          .max(3),
      }),
    )
    .max(10000),
});
