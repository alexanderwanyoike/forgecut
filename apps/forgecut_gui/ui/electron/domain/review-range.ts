import type { Project, ReviewRange } from "../shared/ipc-contract.js";
import type { Result } from "../shared/result.js";
import { frameAtOrAfter, sequenceDurationUs } from "./sequence.js";

export const MIN_REVIEW_DURATION_US = 100000;
export const MAX_REVIEW_DURATION_US = 30000000;
export type ReviewWindow = {
  startSeconds: number;
  durationSeconds: number;
  frameCount: number;
};

export function resolveReviewWindow(
  project: Project,
  range?: ReviewRange,
): Result<ReviewWindow | undefined> {
  if (!range) return { ok: true, value: undefined };
  const invalid: Result<never> = {
    ok: false,
    error: {
      code: "INVALID_INPUT",
      message:
        "Choose a review range within the sequence, between 0.1 and 30 seconds and containing at least one frame",
    },
  };
  if (
    !Number.isSafeInteger(range.startUs) ||
    !Number.isSafeInteger(range.endUs) ||
    range.startUs < 0 ||
    range.endUs > sequenceDurationUs(project) ||
    range.endUs - range.startUs < MIN_REVIEW_DURATION_US ||
    range.endUs - range.startUs > MAX_REVIEW_DURATION_US
  )
    return invalid;
  const { fps } = project.settings;
  const start = frameAtOrAfter(range.startUs, fps);
  const end = frameAtOrAfter(range.endUs, fps);
  const durationSeconds = (end - start) / fps;
  if (end <= start || durationSeconds > MAX_REVIEW_DURATION_US / 1000000)
    return invalid;
  return {
    ok: true,
    value: {
      startSeconds: start / fps,
      durationSeconds,
      frameCount: end - start,
    },
  };
}
