import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Project,
  ProjectSettings,
} from "../../electron/shared/ipc-contract";
import type { RemotionGraphicItem } from "../../electron/shared/graphics";
import { invoke } from "../lib/bridge";

type Render = { fingerprint: string; path?: string };

/** A card's render, or whether one is still worth waiting for. */
export type GraphicPlayback = { path?: string; pending: boolean };

const RETRYABLE = new Set(["CONFLICT", "CANCELLED", "PROJECT_CHANGED"]);

// A conflicting edit may land before its snapshot reaches the editor, so retry after a pause.
const RETRY_MS = 250;

/**
 * Keeps a whole-card render ready for every graphic in the sequence; a render
 * only counts while it matches the card's current content.
 */
export function useGraphicPlayback(
  project: Project | undefined,
  revision: number,
): (item: RemotionGraphicItem) => GraphicPlayback {
  const [renders, setRenders] = useState<ReadonlyMap<string, Render>>(
    () => new Map(),
  );
  const pending = useRef(new Set<string>());
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!project) return;
    for (const item of graphics(project)) {
      const fingerprint = renderFingerprint(item, project.settings);
      const request = `${item.id}:${fingerprint}`;
      if (
        renders.get(item.id)?.fingerprint === fingerprint ||
        pending.current.has(request)
      )
        continue;
      pending.current.add(request);
      invoke("get_graphic_playback", { itemId: item.id, revision })
        .then(({ path }) =>
          setRenders((current) =>
            new Map(current).set(item.id, { fingerprint, path }),
          ),
        )
        .catch((failure: unknown) => {
          const code = (failure as { code?: unknown } | null)?.code;
          if (typeof code === "string" && RETRYABLE.has(code))
            setTimeout(() => retry((value) => value + 1), RETRY_MS);
          else
            setRenders((current) =>
              new Map(current).set(item.id, { fingerprint }),
            );
        })
        .finally(() => pending.current.delete(request));
    }
  }, [project, revision, renders, attempt]);
  return useCallback(
    (item) => {
      const render = renders.get(item.id);
      return project &&
        render?.fingerprint === renderFingerprint(item, project.settings)
        ? { path: render.path, pending: false }
        : { pending: true };
    },
    [project, renders],
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
