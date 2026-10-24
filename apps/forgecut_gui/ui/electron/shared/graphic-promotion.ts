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
