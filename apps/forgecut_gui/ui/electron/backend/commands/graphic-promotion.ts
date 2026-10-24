import type { GraphicPromotionRequest } from "../../shared/graphic-promotion.js";
import { startGraphicPromotion } from "../graphic-promotion.js";
import { EditingError } from "../editing-error.js";
import type { CommandRegistry } from "./types.js";

export const graphicPromotionCommands = {
  start_graphic_promotion: (args, { state, jobs, drafts, preview }) => {
    if (!jobs || !drafts || !preview)
      throw new EditingError("UNAVAILABLE", "Source promotion is unavailable");
    const result = startGraphicPromotion(
      state,
      jobs,
      drafts,
      preview,
      args as GraphicPromotionRequest,
    );
    if (!result.ok) {
      let code: "PROJECT_CHANGED" | "REQUEST_REUSED" | "IO_ERROR" = "IO_ERROR";
      if (
        result.error.code === "PROJECT_CHANGED" ||
        result.error.code === "REQUEST_REUSED"
      )
        code = result.error.code;
      throw new EditingError(code, result.error.message);
    }
    return result.value;
  },
} satisfies CommandRegistry;
