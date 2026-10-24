import type { SourceReviewRequest } from "../shared/source-review.js";
import type { AppState } from "./state.js";
import type { JobQueue } from "./job-queue.js";
import { sourceReview } from "./source-review.js";

export function startSourceReview(
  state: AppState,
  jobs: JobQueue,
  request: SourceReviewRequest,
) {
  state.assertSession(request.sessionId);
  return jobs.start(
    {
      sessionId: request.sessionId,
      projectRevision: request.expectedRevision,
      requestId: request.requestId,
      kind: request.kind,
      label:
        request.kind === "contact-sheet"
          ? "Source contact sheet"
          : "Source waveform",
      input: request,
    },
    async (signal) => {
      if (state.sessionId !== request.sessionId)
        return {
          ok: false,
          error: {
            code: "PROJECT_CHANGED",
            message: "The project changed before source review started",
          },
        };
      if (state.revision !== request.expectedRevision)
        return {
          ok: false,
          error: {
            code: "CONFLICT",
            message:
              "The project changed before source review started. Read it again and retry",
          },
        };
      const asset = state.project.assets.find(
        (candidate) => candidate.id === request.assetId,
      );
      return asset
        ? sourceReview(asset, request, signal)
        : {
            ok: false,
            error: { code: "NOT_FOUND", message: "Source asset not found" },
          };
    },
  );
}
