import { requiredString, type CommandRegistry } from "./types.js";

export const mediaCommands: CommandRegistry = {
  get_assets: (_args, { state }) => state.project.assets,
  remove_asset: (args, { state }) => {
    const assetId = requiredString(args, "id");
    state.project.assets = state.project.assets.filter((asset) => asset.id !== assetId);
  },
  get_clip_thumbnails: () => [],
};
