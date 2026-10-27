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

function invalidRange(): Result<never> {
  return {
    ok: false,
    error: {
      code: "INVALID_INPUT",
      message:
        "Choose a review range within the sequence, between 0.1 and 30 seconds and containing at least one frame",
    },
  };
}

export function validateReviewRange(
  range: ReviewRange,
  durationUs: number,
): Result<ReviewRange> {
  if (
    !Number.isSafeInteger(range.startUs) ||
    !Number.isSafeInteger(range.endUs) ||
    range.startUs < 0 ||
    range.endUs > durationUs ||
    range.endUs - range.startUs < MIN_REVIEW_DURATION_US ||
    range.endUs - range.startUs > MAX_REVIEW_DURATION_US
  )
    return invalidRange();
  return { ok: true, value: range };
}

export function resolveReviewWindow(
  project: Project,
  range?: ReviewRange,
): Result<ReviewWindow | undefined> {
  if (!range) return { ok: true, value: undefined };
  const validated = validateReviewRange(range, sequenceDurationUs(project));
  if (!validated.ok) return validated;
  const { fps } = project.settings;
  const start = frameAtOrAfter(range.startUs, fps);
  const end = frameAtOrAfter(range.endUs, fps);
  const durationSeconds = (end - start) / fps;
  if (end <= start || durationSeconds > MAX_REVIEW_DURATION_US / 1000000)
    return invalidRange();
  return {
    ok: true,
    value: {
      startSeconds: start / fps,
      durationSeconds,
      frameCount: end - start,
    },
  };
}
