import { useCallback } from "react";
import type { Asset, Project } from "../../electron/shared/ipc-contract";
import { invoke } from "../lib/bridge";
import { useRequestedResults } from "./useRequestedResults";

/**
 * Asks for seek-friendly proxies of the sequence's video sources and returns
 * the path to play: the proxy once it is ready, otherwise the original.
 */
export function useMediaProxies(
  project: Project | undefined,
): (asset: Asset) => string {
  const lookup = useRequestedResults<string | null>(
    (project ? videoSources(project) : []).map((asset) => ({
      slot: asset.id,
      key: asset.path,
      load: () =>
        invoke("get_preview_proxy", { assetId: asset.id }).then(
          ({ path }) => path,
        ),
    })),
  );
  return useCallback(
    (asset) => {
      const result = lookup(asset.id, asset.path);
      return result && "value" in result && result.value
        ? result.value
        : asset.path;
    },
    [lookup],
  );
}

function videoSources(project: Project): Asset[] {
  const used = project.timeline.tracks
    .flatMap((track) => track.items)
    .flatMap((item) => ("VideoClip" in item ? [item.VideoClip] : []))
    .sort((a, b) => a.timeline_start_us - b.timeline_start_us)
    .map((clip) => clip.asset_id);
  return [...new Set(used)].flatMap((id) =>
    project.assets.filter((asset) => asset.id === id && asset.kind === "Video"),
  );
}
