import { z } from "zod";

export const fitSchema = z.enum(["contain", "cover"]);
export const visualPlacementSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  opacity: z.number().min(0).max(1),
  fit: fitSchema,
});
