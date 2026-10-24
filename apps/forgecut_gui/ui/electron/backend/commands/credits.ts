import type { CommandMap } from "../../shared/ipc-contract.js";
import { EditingError } from "../editing-error.js";
import type { CommandRegistry } from "./types.js";

export const creditCommands = {
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
