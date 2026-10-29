import type { Result } from "./result.js";

export type GraphicDiagnostic = {
  file: string;
  line: number;
  column: number;
  message: string;
};
export type GraphicCompilation = Result<
  { code: string },
  { code: "INVALID_SOURCE"; message: string; diagnostics: GraphicDiagnostic[] }
>;
export const graphicPackages = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "remotion",
  "@remotion/fonts",
] as const;
