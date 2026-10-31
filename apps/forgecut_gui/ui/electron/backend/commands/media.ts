import { extname } from "node:path";
import { rm } from "node:fs/promises";
import { prepareStoryboardMedia } from "../storyboard-package.js";
import { importAsset } from "../media-probe.js";
import { EditingError } from "../editing-error.js";
import type { Asset } from "../state.js";
import { extractThumbnailsBase64, extractWaveform } from "../media-derived.js";
import {
  requiredString,
  requiredStringArray,
  type CommandRegistry,
} from "./types.js";

export const mediaCommands = {
  get_preview_proxy: async (args, { state, proxies }) => {
    if (!proxies)
      throw new EditingError("UNAVAILABLE", "Preview proxies are unavailable");
    const assetId = requiredString(args, "assetId");
    const asset = state.project.assets.find(
      (candidate) => candidate.id === assetId && candidate.kind === "Video",
    );
    if (!asset) throw new EditingError("NOT_FOUND", "Video asset not found");
    const proxy = await proxies.prepare(asset.path);
    if (!proxy.ok)
      throw new EditingError(
        proxy.error.code === "CANCELLED" || proxy.error.code === "UNAVAILABLE"
          ? proxy.error.code
          : "IO_ERROR",
        proxy.error.message,
      );
    return { path: proxy.value ?? null };
  },
  import_assets: async (args, { state, signal, onProgress, beginCommit }) => {
    const { sessionId } = state;
    const { revision } = state;
    const imported: Asset[] = [];
    const paths = requiredStringArray(args, "paths");
    const directories: string[] = [];
    let committed = false;
    try {
      for (const path of paths) {
        if (signal?.aborted)
          throw new EditingError("CANCELLED", "Import cancelled.");
        let files: { path: string; name?: string }[] = [{ path }];
        if (extname(path).toLowerCase() === ".sbz") {
          const prepared = await prepareStoryboardMedia(path, signal);
          if (!prepared.ok)
            throw new EditingError(
              prepared.error.code === "CANCELLED"
                ? "CANCELLED"
                : "INVALID_INPUT",
              prepared.error.message,
            );
          directories.push(prepared.value.directory);
          files = prepared.value.files;
        }
        for (const file of files) {
          const asset = await importAsset(file.path, signal);
          if (file.name) asset.name = file.name;
          imported.push(asset);
        }
        onProgress?.(
          Math.min(0.9, ((paths.indexOf(path) + 1) / paths.length) * 0.9),
        );
      }
      if (signal?.aborted)
        throw new EditingError("CANCELLED", "Import cancelled.");
      state.assertSession(sessionId);
      if (state.revision !== revision)
        throw new EditingError(
          "CONFLICT",
          "The project changed while importing media. Read it again and retry.",
        );
      if (beginCommit && !beginCommit())
        throw new EditingError(
          "CANCELLED",
          "Import cancelled before publication",
        );
      state.executeProjectChange(
        (project) => {
          project.assets.push(...imported);
        },
        { availablePaths: imported.map((asset) => asset.path) },
      );
      committed = true;
    } finally {
      if (!committed)
        await Promise.all(
          directories.map((directory) =>
            rm(directory, { recursive: true, force: true }),
          ),
        );
    }
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
    const { sessionId } = state;
    const { revision } = state;
    const id = requiredString(args, "id");
    requireAsset(state.project.assets, id);
    const replacement = await importAsset(requiredString(args, "path"));
    state.assertSession(sessionId);
    if (state.revision !== revision) {
      throw new EditingError(
        "CONFLICT",
        "The project changed while probing replacement media. Try relinking again.",
      );
    }
    state.executeProjectChange(
      (project) => {
        const original = requireAsset(project.assets, id);
        if (original.kind !== replacement.kind)
          throw new Error("Replacement media must have the same kind");
        Object.assign(original, replacement, { id });
      },
      { availablePaths: [replacement.path] },
    );
    return state.project.assets.find((asset) => asset.id === id)!;
  },
  get_clip_thumbnails: async (args, { state }) => {
    const asset = requireAsset(
      state.project.assets,
      requiredString(args, "assetId"),
    );
    const durationSeconds = (asset.probe?.duration_us ?? 5_000_000) / 1_000_000;
    return extractThumbnailsBase64(asset.path, asset.id, durationSeconds);
  },
  get_waveform: async (args, { state }) => {
    const asset = requireAsset(
      state.project.assets,
      requiredString(args, "assetId"),
    );
    return extractWaveform(asset.path, asset.id, 256);
  },
} satisfies CommandRegistry;

function requireAsset<T extends { id: string }>(
  assets: T[],
  assetId: string,
): T {
  const asset = assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error("Asset not found");
  return asset;
}
