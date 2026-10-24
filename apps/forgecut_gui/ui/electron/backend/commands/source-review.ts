import type { CommandMap } from "../../shared/ipc-contract.js";
import { EditingError } from "../editing-error.js";
import { startSourceReview } from "../source-review-jobs.js";
import type { CommandRegistry } from "./types.js";

export const sourceReviewCommands = {
  start_source_review: (args, { state, jobs }) => {
    if (!jobs)
      throw new EditingError(
        "UNAVAILABLE",
        "Source review jobs are unavailable",
      );
    const result = startSourceReview(
      state,
      jobs,
      args as CommandMap["start_source_review"]["args"],
    );
    if (!result.ok) {
      const code = result.error.code;
      throw new EditingError(
        code === "REQUEST_REUSED" ||
          code === "QUEUE_FULL" ||
          code === "QUEUE_CLOSED"
          ? code
          : "IO_ERROR",
        result.error.message,
      );
    }
    return result.value;
  },
} satisfies CommandRegistry;
