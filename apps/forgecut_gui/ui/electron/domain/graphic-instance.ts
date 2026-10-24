import { projectSequences } from "./project-sequences.js";
import type { ProjectSequence, Project } from "../shared/ipc-contract.js";
import type {
  GraphicComponent,
  RemotionGraphicItem,
} from "../shared/graphics.js";
import type { Result } from "../shared/result.js";

export function resolveGraphicInstance(
  project: Project,
  itemId: string,
): Result<
  {
    item: RemotionGraphicItem;
    component: GraphicComponent;
    sequence: ProjectSequence;
  },
  { code: "NOT_FOUND"; message: string }
> {
  const sequence = projectSequences(project).find((value) =>
    value.timeline.tracks.some((track) =>
      track.items.some(
        (item) =>
          "RemotionGraphic" in item && item.RemotionGraphic.id === itemId,
      ),
    ),
  );
  const found = sequence?.timeline.tracks
    .flatMap((track) => track.items)
    .find(
      (item) => "RemotionGraphic" in item && item.RemotionGraphic.id === itemId,
    );
  if (!sequence || !found || !("RemotionGraphic" in found))
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Graphic instance not found" },
    };
  const item = found.RemotionGraphic;
  const component = project.components?.find(
    (candidate) =>
      candidate.id === item.component_id &&
      candidate.version === item.component_version,
  );
  return component
    ? { ok: true, value: { item, component, sequence } }
    : {
        ok: false,
        error: { code: "NOT_FOUND", message: "Graphic component not found" },
      };
}
