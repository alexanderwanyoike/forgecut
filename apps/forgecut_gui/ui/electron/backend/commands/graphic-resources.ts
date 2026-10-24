import type { CommandMap } from "../../shared/ipc-contract.js";
import { importGraphicResource } from "../graphic-resource-import.js";
import { EditingError } from "../editing-error.js";
import type { CommandRegistry } from "./types.js";

export const graphicResourceCommands = {
  import_graphic_resource: async (args, { state, signal }) => {
    const input = args as CommandMap["import_graphic_resource"]["args"];
    const { sessionId, revision } = state;
    const imported = await importGraphicResource(
      input.path,
      input.kind,
      input.license,
    );
    if (!imported.ok)
      throw new EditingError(
        imported.error.code === "INVALID_INPUT" ? "INVALID_INPUT" : "IO_ERROR",
        imported.error.message,
      );
    if (signal?.aborted)
      throw new EditingError("CANCELLED", "Resource import cancelled");
    state.assertSession(sessionId);
    if (state.revision !== revision)
      throw new EditingError(
        "CONFLICT",
        "Project changed while importing the resource. Read it again and retry.",
      );
    state.executeProjectChange((project) => {
      project.resources ??= [];
      project.resources.push(imported.value);
    });
    return imported.value;
  },
} satisfies CommandRegistry;
