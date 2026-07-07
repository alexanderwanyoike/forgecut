import { importAsset } from "../media-probe.js";
import {
  extractThumbnailsBase64,
  extractWaveform,
} from "../media-derived.js";
import {
  requiredString,
  requiredStringArray,
  type CommandRegistry,
} from "./types.js";

export const mediaCommands = {
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
  get_clip_thumbnails: async (args, { state }) => {
    const asset = requireAsset(state.project.assets, requiredString(args, "assetId"));
    const durationSeconds = (asset.probe?.duration_us ?? 5_000_000) / 1_000_000;
    return extractThumbnailsBase64(asset.path, asset.id, durationSeconds);
  },
  get_waveform: async (args, { state }) => {
    const asset = requireAsset(state.project.assets, requiredString(args, "assetId"));
    return extractWaveform(asset.path, asset.id, 256);
  },
} satisfies CommandRegistry;

function requireAsset<T extends { id: string }>(assets: T[], assetId: string): T {
  const asset = assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error("Asset not found");
  return asset;
}
