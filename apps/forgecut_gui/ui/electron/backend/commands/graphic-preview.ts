import type { CommandMap } from "../../shared/ipc-contract.js";
import { graphicPreviewError } from "../graphic-preview-error.js";
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
    if (!result.ok) throw graphicPreviewError(result.error);
    return result.value;
  },
  get_graphic_playback: async (args, { state, renders }) => {
    if (!renders)
      throw new EditingError("UNAVAILABLE", "Graphics playback is unavailable");
    const input = args as CommandMap["get_graphic_playback"]["args"];
    if (input.revision !== state.revision)
      throw new EditingError(
        "CONFLICT",
        "The project changed before this graphic rendered. Request it again.",
      );
    const result = await renders.prepare(state.project, input.itemId);
    if (!result.ok) throw graphicPreviewError(result.error);
    return { path: result.value };
  },
} satisfies CommandRegistry;
