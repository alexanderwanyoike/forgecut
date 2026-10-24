import { randomUUID } from "node:crypto";
import type { Project } from "../shared/ipc-contract.js";
import type { GraphicDraft } from "../shared/graphic-draft.js";
import type { GraphicPromotionRequest } from "../shared/graphic-promotion.js";
import type { Result } from "../shared/result.js";
import { resolveGraphicInstance } from "../domain/graphic-instance.js";
import { migrateGraphicInstance } from "../domain/graphic-migration.js";
import { validateGraphicDependencies } from "../domain/graphic-dependencies.js";
import { componentVersion } from "./graphic-component.js";
import { validateProject } from "./project-schema.js";

export function prepareGraphicPromotion(
  project: Project,
  draft: GraphicDraft,
  request: GraphicPromotionRequest,
): Result<{
  project: Project;
  itemIds: string[];
  componentId: string;
  version: string;
}> {
  const resolved = resolveGraphicInstance(project, request.itemId);
  if (!resolved.ok) return resolved;
  const previous = resolved.value.component;
  if (previous.version !== draft.baseVersion)
    return {
      ok: false,
      error: {
        code: "CONFLICT",
        message: "The active component changed. Reconcile or revert the draft.",
      },
    };
  const component = structuredClone(draft.component);
  component.id = request.scope === "shared" ? previous.id : randomUUID();
  component.version = componentVersion(component);
  const dependencies = validateGraphicDependencies(component);
  if (!dependencies.ok) return dependencies;
  if (component.version === previous.version)
    return {
      ok: true,
      value: {
        project: structuredClone(project),
        itemIds: [],
        componentId: previous.id,
        version: previous.version,
      },
    };
  const candidate = structuredClone(project);
  const itemIds: string[] = [];
  for (const track of candidate.timeline.tracks)
    for (const item of track.items) {
      if (!("RemotionGraphic" in item)) continue;
      const graphic = item.RemotionGraphic;
      if (
        graphic.id !== request.itemId &&
        !(
          request.scope === "shared" &&
          graphic.component_id === previous.id &&
          graphic.component_version === previous.version
        )
      )
        continue;
      const migrated = migrateGraphicInstance(
        previous,
        component,
        graphic,
        request.mappings,
      );
      if (!migrated.ok) return migrated;
      item.RemotionGraphic = migrated.value;
      itemIds.push(graphic.id);
    }
  candidate.components ??= [];
  if (
    !candidate.components.some(
      (value) =>
        value.id === component.id && value.version === component.version,
    )
  )
    candidate.components.push(component);
  const references = new Set(
    candidate.timeline.tracks.flatMap((track) =>
      track.items.flatMap((item) =>
        "RemotionGraphic" in item
          ? [
              `${item.RemotionGraphic.component_id}:${item.RemotionGraphic.component_version}`,
            ]
          : [],
      ),
    ),
  );
  candidate.components = candidate.components.filter((value) =>
    references.has(`${value.id}:${value.version}`),
  );
  try {
    return {
      ok: true,
      value: {
        project: validateProject(candidate),
        itemIds,
        componentId: component.id,
        version: component.version,
      },
    };
  } catch (failure) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: failure instanceof Error ? failure.message : String(failure),
      },
    };
  }
}
