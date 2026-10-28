import { useCallback } from "react";
import type {
  Project,
  ProjectSettings,
} from "../../electron/shared/ipc-contract";
import type { RemotionGraphicItem } from "../../electron/shared/graphics";
import { invoke } from "../lib/bridge";
import { useRequestedResults } from "./useRequestedResults";

/** A card's render, or whether one is still worth waiting for. */
export type GraphicPlayback = { path?: string; pending: boolean };

/**
 * Keeps a whole-card render ready for every graphic in the sequence; a render
 * only counts while it matches the card's current content.
 */
export function useGraphicPlayback(
  project: Project | undefined,
  revision: number,
): (item: RemotionGraphicItem) => GraphicPlayback {
  const lookup = useRequestedResults<string>(
    project
      ? graphics(project).map((item) => ({
          slot: item.id,
          key: renderFingerprint(item, project.settings),
          load: () =>
            invoke("get_graphic_playback", { itemId: item.id, revision }).then(
              ({ path }) => path,
            ),
        }))
      : [],
  );
  return useCallback(
    (item) => {
      const result =
        project && lookup(item.id, renderFingerprint(item, project.settings));
      if (!result) return { pending: true };
      return {
        path: "value" in result ? result.value : undefined,
        pending: false,
      };
    },
    [project, lookup],
  );
}

function graphics(project: Project): RemotionGraphicItem[] {
  return project.timeline.tracks
    .flatMap((track) => track.items)
    .flatMap((item) =>
      "RemotionGraphic" in item ? [item.RemotionGraphic] : [],
    )
    .sort((a, b) => a.timeline_start_us - b.timeline_start_us);
}

function renderFingerprint(
  item: RemotionGraphicItem,
  settings: Pick<ProjectSettings, "width" | "height" | "fps">,
): string {
  return JSON.stringify([item, settings.width, settings.height, settings.fps]);
}
