import { randomUUID } from "node:crypto";
import type { Project } from "../shared/ipc-contract.js";
import type { GraphicDraft } from "../shared/graphic-draft.js";
import type { GraphicPromotionRequest } from "../shared/graphic-promotion.js";
import type { Result } from "../shared/result.js";
import type { JobQueue } from "./job-queue.js";
import type { AppState } from "./state.js";
import type { GraphicPreviewService } from "./GraphicPreviewService.js";
import type { GraphicDraftStore } from "./GraphicDraftStore.js";
import { resolveGraphicInstance } from "../domain/graphic-instance.js";
import { migrateGraphicInstance } from "../domain/graphic-migration.js";
import { frameAtOrAfter } from "../domain/sequence.js";
import { validateGraphicDependencies } from "../domain/graphic-dependencies.js";
import { componentVersion } from "./graphic-component.js";
import { validateProject } from "./project-schema.js";

function prepare(
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

export function startGraphicPromotion(
  state: AppState,
  jobs: JobQueue,
  drafts: GraphicDraftStore,
  preview: GraphicPreviewService,
  request: GraphicPromotionRequest,
) {
  if (state.sessionId !== request.sessionId)
    return {
      ok: false as const,
      error: { code: "PROJECT_CHANGED", message: "Project session changed" },
    };
  const snapshot = state.project;
  const { revision } = state;
  return jobs.start(
    {
      sessionId: request.sessionId,
      projectRevision: request.expectedRevision,
      requestId: request.requestId,
      kind: "compile",
      label: "Apply graphic source",
      input: request,
    },
    async (signal, report, beginCommit) => {
      if (revision !== request.expectedRevision)
        return {
          ok: false,
          error: {
            code: "CONFLICT",
            message: "Read the current project revision before applying source",
          },
        };
      const resolved = resolveGraphicInstance(snapshot, request.itemId);
      if (!resolved.ok) return resolved;
      const initial: GraphicDraft = {
        projectId: snapshot.id,
        itemId: request.itemId,
        baseVersion: resolved.value.component.version,
        revision: 0,
        component: resolved.value.component,
      };
      const draft = await drafts.read(initial);
      if (!draft.ok) return draft;
      if (draft.value.revision !== request.expectedDraftRevision)
        return {
          ok: false,
          error: { code: "CONFLICT", message: "The source draft changed" },
        };
      const prepared = prepare(snapshot, draft.value, request);
      if (!prepared.ok) return prepared;
      for (const [index, itemId] of prepared.value.itemIds.entries()) {
        const item = resolveGraphicInstance(prepared.value.project, itemId);
        if (!item.ok) return item;
        const graphic = item.value.item;
        const duration = Math.max(
          1,
          frameAtOrAfter(
            graphic.timeline_start_us + graphic.duration_us,
            snapshot.settings.fps,
          ) - frameAtOrAfter(graphic.timeline_start_us, snapshot.settings.fps),
        );
        for (const frame of new Set([0, duration - 1])) {
          const checked = await preview.render(
            prepared.value.project,
            request.sessionId,
            itemId,
            undefined,
            frame,
            signal,
          );
          if (!checked.ok) return checked;
        }
        report((index + 1) / prepared.value.itemIds.length);
      }
      let committed = false;
      let committedRevision = revision;
      const applied = await drafts.commit(
        initial,
        request.expectedDraftRevision,
        () => {
          if (state.sessionId !== request.sessionId)
            return {
              ok: false,
              error: {
                code: "PROJECT_CHANGED",
                message: "Project changed during source validation",
              },
            };
          if (state.revision !== request.expectedRevision)
            return {
              ok: false,
              error: {
                code: "CONFLICT",
                message:
                  "The project changed during source validation. Your edits were retained.",
              },
            };
          if (signal.aborted || !beginCommit())
            return {
              ok: false,
              error: {
                code: "CANCELLED",
                message: "Source promotion cancelled",
              },
            };
          state.executeProjectChange((project) =>
            Object.assign(project, prepared.value.project),
          );
          committed = true;
          committedRevision = state.revision;
          return { ok: true, value: undefined };
        },
      );
      if (!applied.ok && !committed) return applied;
      return {
        ok: true,
        value: {
          revision: committedRevision,
          changedItemIds: prepared.value.itemIds,
          componentId: prepared.value.componentId,
          version: prepared.value.version,
          ...(!applied.ok
            ? { warning: `Source applied; ${applied.error.message}` }
            : {}),
        },
      };
    },
  );
}
