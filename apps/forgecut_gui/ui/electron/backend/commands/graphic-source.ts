import type { GraphicComponent } from "../../shared/graphics.js";
import { checkGraphicSource } from "../graphic-source-check.js";
import { EditingError } from "../editing-error.js";
import type { CommandRegistry } from "./types.js";

export const graphicSourceCommands = {
  check_graphic_source: async (args, { signal }) => {
    const checked = await checkGraphicSource(
      args?.source as GraphicComponent["source"],
      signal,
    );
    if (!checked.ok)
      throw new EditingError(
        checked.error.code === "CANCELLED" ? "CANCELLED" : "IO_ERROR",
        checked.error.message,
      );
    return checked.value;
  },
} satisfies CommandRegistry;
