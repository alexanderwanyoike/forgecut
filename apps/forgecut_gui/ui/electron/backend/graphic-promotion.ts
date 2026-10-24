import { prepareGraphicPromotion } from "./graphic-promotion-candidate.js";
import type { GraphicDraft } from "../shared/graphic-draft.js";
import type { GraphicPromotionRequest } from "../shared/graphic-promotion.js";
import type { JobQueue } from "./job-queue.js";
import type { AppState } from "./state.js";
import type { GraphicPreviewService } from "./GraphicPreviewService.js";
import type { GraphicDraftStore } from "./GraphicDraftStore.js";
import { resolveGraphicInstance } from "../domain/graphic-instance.js";
import { frameAtOrAfter } from "../domain/sequence.js";

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
      const prepared = prepareGraphicPromotion(snapshot, draft.value, request);
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
