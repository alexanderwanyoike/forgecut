import { z } from "zod";

export const graphicDiagnosticSchema = z.strictObject({
  file: z.string().min(1).max(512),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  message: z.string().max(8192),
});
export const graphicDiagnosticsSchema = z
  .array(graphicDiagnosticSchema)
  .max(100);
export const graphicRuntimeFailureSchema = z.strictObject({
  code: z.string(),
  message: z.string().max(8192),
  diagnostics: graphicDiagnosticsSchema.optional(),
});
export type GraphicRuntimeFailure = z.infer<typeof graphicRuntimeFailureSchema>;
