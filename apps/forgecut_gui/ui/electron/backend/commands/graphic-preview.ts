import type { CommandMap, EditErrorCode } from "../../shared/ipc-contract.js";
import { EditingError } from "../editing-error.js";
import type { CommandRegistry } from "./types.js";

export const graphicPreviewCommands = {
  get_graphic_preview: async (args, { state, preview, signal }) => {
    if (!preview)
      throw new EditingError("UNAVAILABLE", "Graphics preview is unavailable");
    const input = args as CommandMap["get_graphic_preview"]["args"];
    const result = await preview.render(
      state.project,
      state.sessionId,
      input.itemId,
      input.props,
      input.frame,
      signal,
    );
    if (!result.ok) {
      const codes: EditErrorCode[] = [
        "NOT_FOUND",
        "INVALID_INPUT",
        "CANCELLED",
        "PROJECT_CHANGED",
        "UNAVAILABLE",
        "RENDER_FAILED",
        "TIMEOUT",
      ];
      const code =
        codes.find((candidate) => candidate === result.error.code) ??
        "IO_ERROR";
      throw new EditingError(code, result.error.message);
    }
    return result.value;
  },
} satisfies CommandRegistry;
