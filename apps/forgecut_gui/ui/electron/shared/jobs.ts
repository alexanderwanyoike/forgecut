import type { Result } from "./result.js";

export type JobKind = "import" | "frame" | "export";
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
