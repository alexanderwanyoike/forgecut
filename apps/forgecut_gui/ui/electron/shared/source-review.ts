export type SourceReviewRequest = {
  sessionId: string;
  expectedRevision: number;
  requestId: string;
  assetId: string;
  startUs: number;
  endUs: number;
  kind: "contact-sheet" | "waveform";
};
export type SourceReviewMetadata = Pick<
  SourceReviewRequest,
  "assetId" | "startUs" | "endUs"
>;
export type ContactSheet = SourceReviewMetadata & {
  mimeType: "image/jpeg";
  data: string;
  columns: number;
  rows: number;
  timesUs: number[];
};
export type SourceWaveform = SourceReviewMetadata & {
  sampleRate: number;
  samplesPerPeak: number;
  peaks: [number, number][];
};
export type SourceReview = ContactSheet | SourceWaveform;
