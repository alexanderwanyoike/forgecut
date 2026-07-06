import type { CommandRegistry } from "./types.js";

export const mediaCommands: CommandRegistry = {
  get_assets: (_args, { state }) => state.project.assets,
  get_clip_thumbnails: () => [],
};
