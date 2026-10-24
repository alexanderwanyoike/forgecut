import { z } from "zod";

export type GraphicMigration = {
  properties?: Record<string, string | null>;
  layers?: Record<string, string | null>;
};
export type GraphicPromotionRequest = {
  itemId: string;
  sessionId: string;
  expectedRevision: number;
  expectedDraftRevision: number;
  requestId: string;
  scope?: "instance" | "shared";
  mappings?: GraphicMigration;
};

export const graphicPromotionResultSchema = z.object({
  revision: z.number().int().nonnegative(),
  changedItemIds: z.array(z.uuid()),
  componentId: z.uuid(),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  warning: z.string().optional(),
});
export type GraphicPromotionResult = z.infer<
  typeof graphicPromotionResultSchema
>;
