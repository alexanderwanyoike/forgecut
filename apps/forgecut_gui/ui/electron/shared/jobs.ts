import type { Result } from "./result.js";

export const EXPORT_TIMEOUT_MS = 30 * 60 * 1000;

export type JobKind =
  | "collect"
  | "import"
  | "frame"
  | "export"
  | "compile"
  | "contact-sheet"
  | "waveform"
  | "source-preview";
export type JobStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "committing"
  | "completed"
  | "failed"
  | "cancelled";
export type JobRequest = {
  sessionId: string;
  projectRevision: number;
  requestId: string;
  kind: JobKind;
  label: string;
  input: unknown;
};
export type JobSnapshot = {
  id: string;
  sessionId: string;
  projectRevision: number;
  requestId: string;
  kind: JobKind;
  label: string;
  status: JobStatus;
  progress: number;
  result: Result<unknown> | null;
};
