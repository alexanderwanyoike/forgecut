import { z } from "zod";
import type { Result } from "./result.js";

const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const details = { currentVersion: version };
export const updateStatusSchema = z.discriminatedUnion("stage", [
  z.object({ ...details, stage: z.literal("manual") }),
  z.object({ ...details, stage: z.literal("idle") }),
  z.object({ ...details, stage: z.literal("checking") }),
  z.object({ ...details, stage: z.literal("available"), version }),
  z.object({
    ...details,
    stage: z.literal("downloading"),
    version,
    percent: z.number().min(0).max(100),
  }),
  z.object({ ...details, stage: z.literal("ready"), version }),
]);
export type UpdateStatus = z.infer<typeof updateStatusSchema>;
export type UpdateResult = Result<UpdateStatus>;
export type UpdateOperation =
  "status" | "check" | "download" | "install" | "releases";
export interface UpdatesBridge {
  status: () => Promise<UpdateResult>;
  check: () => Promise<UpdateResult>;
  download: () => Promise<UpdateResult>;
  install: () => Promise<UpdateResult>;
  releases: () => Promise<UpdateResult>;
}
