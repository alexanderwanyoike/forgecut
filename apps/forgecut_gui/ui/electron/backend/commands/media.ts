import { importAsset } from "../media-probe.js";
import {
  requiredString,
  requiredStringArray,
  type CommandRegistry,
} from "./types.js";

export const mediaCommands: CommandRegistry = {
  import_assets: async (args, { state }) => {
    const imported = [];
    for (const path of requiredStringArray(args, "paths")) {
      try {
        const asset = await importAsset(path);
        state.project.assets.push(asset);
        imported.push(asset);
      } catch (error) {
        throw new Error(`Failed to import ${path}: ${String(error)}`);
      }
    }
    return imported;
  },
  get_assets: (_args, { state }) => state.project.assets,
  remove_asset: (args, { state }) => {
    const assetId = requiredString(args, "id");
    state.project.assets = state.project.assets.filter((asset) => asset.id !== assetId);
  },
  get_clip_thumbnails: () => [],
};
