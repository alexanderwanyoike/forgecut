import type { CommandMap } from "../../shared/ipc-contract.js";
import { EditingError } from "../editing-error.js";
import type { CommandRegistry } from "./types.js";

export const creditCommands = {
  set_resource_license: (args, { state }) => {
    const input = args as CommandMap["set_resource_license"]["args"];
    state.executeProjectChange((project) => {
      const resource = project.resources?.find(
        (value) => value.id === input.resourceId,
      );
      if (!resource)
        throw new EditingError("NOT_FOUND", "Graphic resource not found");
      resource.license = input.license;
    });
    return state.project.resources!.find(
      (value) => value.id === input.resourceId,
    )!;
  },
  set_asset_license: (args, { state }) => {
    const input = args as CommandMap["set_asset_license"]["args"];
    state.executeProjectChange((project) => {
      const asset = project.assets.find((value) => value.id === input.assetId);
      if (!asset) throw new EditingError("NOT_FOUND", "Asset not found");
      if (input.license === null) delete asset.license;
      else asset.license = input.license;
    });
    return state.project.assets.find((value) => value.id === input.assetId)!;
  },
} satisfies CommandRegistry;
