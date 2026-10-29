import type { Result } from "./result.js";

export type UpdateStatus = { currentVersion: string } & (
  | { stage: "manual" | "idle" | "checking" }
  | { stage: "available" | "ready"; version: string }
  | { stage: "downloading"; version: string; percent: number }
);
export type UpdateResult = Result<UpdateStatus>;
export interface UpdatesBridge {
  status: () => Promise<UpdateResult>;
  check: () => Promise<UpdateResult>;
  download: () => Promise<UpdateResult>;
  install: () => Promise<UpdateResult>;
  releases: () => Promise<UpdateResult>;
}
