export type ProjectCollectionRequest = {
  sessionId: string;
  expectedRevision: number;
  requestId: string;
  directory: string;
  assetIds: string[];
};
export type ProjectCollection = {
  projectPath: string;
  copiedAssets: number;
  externalAssets: number;
};
