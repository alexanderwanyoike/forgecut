import { basename } from "node:path";
import type { CommandMap } from "../../shared/ipc-contract.js";
import { readResourceFile } from "../graphic-resource-store.js";
import { importGraphicResource } from "../graphic-resource-import.js";
import { EditingError } from "../editing-error.js";
import type { CommandRegistry } from "./types.js";

export const graphicResourceCommands = {
  import_graphic_resource: async (args, { state, signal }) => {
    const input = args as CommandMap["import_graphic_resource"]["args"];
    if (input.target) {
      state.assertSession(input.target.sessionId);
      if (state.revision !== input.target.expectedRevision)
        throw new EditingError(
          "CONFLICT",
          "The project changed while choosing the resource. Start the import again.",
        );
    }
    const { sessionId, revision } = state;
    let { license } = input;
    if (input.licensePath) {
      const bytes = await readResourceFile(input.licensePath);
      if (bytes.length === 0 || bytes.length > 65536)
        throw new EditingError(
          "INVALID_INPUT",
          "Resource licence text exceeds 64 KiB",
        );
      license = {
        identifier: basename(input.licensePath),
        text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      };
    }
    if (!license)
      throw new EditingError(
        "INVALID_INPUT",
        "Resource licence metadata is required",
      );
    const imported = await importGraphicResource(
      input.path,
      input.kind,
      license,
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
      if (input.target) {
        const item = project.timeline.tracks
          .flatMap((track) => track.items)
          .find(
            (candidate) =>
              "RemotionGraphic" in candidate &&
              candidate.RemotionGraphic.id === input.target?.itemId,
          );
        if (!item || !("RemotionGraphic" in item))
          throw new Error("The target graphic no longer exists");
        const component = project.components?.find(
          (candidate) =>
            candidate.id === item.RemotionGraphic.component_id &&
            candidate.version === item.RemotionGraphic.component_version,
        );
        if (
          component?.properties[input.target.property]?.type !==
          imported.value.kind.toLowerCase()
        )
          throw new Error(
            "The selected property does not accept this resource kind",
          );
        item.RemotionGraphic.props[input.target.property] = imported.value.id;
      }
    });
    return imported.value;
  },
} satisfies CommandRegistry;
