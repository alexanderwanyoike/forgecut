import { importAsset } from "../media-probe.js";
import type { Asset } from "../state.js";
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
    const sessionId = state.sessionId;
    const imported: Asset[] = [];
    for (const path of requiredStringArray(args, "paths")) {
      try {
        const asset = await importAsset(path);
        imported.push(asset);
      } catch (error) {
        throw new Error(`Failed to import ${path}: ${String(error)}`);
      }
    }
    state.assertSession(sessionId);
    state.executeProjectChange((project) => { project.assets.push(...imported); }, { availablePaths: imported.map((asset) => asset.path) });
    return imported;
  },
  get_assets: (_args, { state }) => state.project.assets,
  remove_asset: (args, { state }) => {
    const assetId = requiredString(args, "id");
    state.executeProjectChange((project) => {
      requireAsset(project.assets, assetId);
      project.assets = project.assets.filter((asset) => asset.id !== assetId);
    });
  },
  relink_asset: async (args, { state }) => {
    const sessionId = state.sessionId;
    const id = requiredString(args, "id");
    requireAsset(state.project.assets, id);
    const replacement = await importAsset(requiredString(args, "path"));
    state.assertSession(sessionId);
    state.executeProjectChange((project) => {
      const original = requireAsset(project.assets, id);
      if (original.kind !== replacement.kind) throw new Error("Replacement media must have the same kind");
      Object.assign(original, replacement, { id });
    }, { availablePaths: [replacement.path] });
    return state.project.assets.find((asset) => asset.id === id)!;
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
