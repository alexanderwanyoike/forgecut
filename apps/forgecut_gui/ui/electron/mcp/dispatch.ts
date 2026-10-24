import { z } from "zod";
import type { EditingService } from "../backend/editing-service.js";
import type { ProjectSnapshot } from "../shared/ipc-contract.js";
import {
  editRequestSchema,
  historyRequestSchema,
} from "../backend/command-schema.js";
import { idSchema, timeSchema } from "../backend/project-schema.js";
import {
  itemData,
  timelineEndUs,
  timelineStartUs,
} from "../backend/timeline-ops.js";
import { EditingError } from "../backend/editing-error.js";
import type { BridgeResult } from "./contract.js";

export const pageFields = {
  sessionId: idSchema,
  offset: timeSchema.default(0),
  limit: z.number().int().min(1).max(100).default(50),
};
export const bridgeRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("summary") }),
  z.strictObject({
    action: z.literal("history"),
    request: historyRequestSchema,
  }),
  z.strictObject({ action: z.literal("assets"), ...pageFields }),
  z.strictObject({
    action: z.literal("timeline"),
    ...pageFields,
    startUs: timeSchema,
    endUs: timeSchema,
  }),
  z.strictObject({
    action: z.literal("item"),
    sessionId: idSchema,
    itemId: idSchema,
  }),
  z.strictObject({
    action: z.literal("apply"),
    request: editRequestSchema,
    label: z.string().min(1).max(120),
  }),
]);

type SummarySource = Pick<
  ProjectSnapshot,
  "project" | "sessionId" | "revision" | "canUndo" | "canRedo"
>;
function summary(source: SummarySource) {
  return {
    projectId: source.project.id,
    sessionId: source.sessionId,
    revision: source.revision,
    name: source.project.name.slice(0, 512),
    settings: source.project.settings,
    assetCount: source.project.assets.length,
    trackCount: source.project.timeline.tracks.length,
    tracks: source.project.timeline.tracks.slice(0, 100).map((track) => ({
      id: track.id,
      kind: track.kind,
      itemCount: track.items.length,
    })),
    canUndo: source.canUndo,
    canRedo: source.canRedo,
  };
}

export async function dispatchLocal(
  service: EditingService,
  input: unknown,
): Promise<BridgeResult> {
  const parsed = bridgeRequestSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: parsed.error.message },
    };
  const request = parsed.data;
  const { state } = service;
  try {
    if (request.action === "summary")
      return { ok: true, value: summary(state) };
    if (request.action === "apply" || request.action === "history") {
      const response = await service.execute(
        request.action === "apply" ? "apply_edits" : "apply_history",
        request.request,
      );
      if (!response.ok) return response;
      const snapshot = response.value as ProjectSnapshot;
      return {
        ok: true,
        value: {
          ...summary(snapshot),
          changedItemIds: snapshot.changedItemIds ?? [],
        },
      };
    }
    state.assertSession(request.sessionId);
    if (request.action === "assets")
      return {
        ok: true,
        value: {
          sessionId: state.sessionId,
          revision: state.revision,
          assets: state.project.assets.slice(
            request.offset,
            request.offset + request.limit,
          ),
          total: state.project.assets.length,
        },
      };
    const items = state.project.timeline.tracks.flatMap((track) => track.items);
    if (request.action === "item") {
      const item = items.find(
        (candidate) => itemData(candidate).id === request.itemId,
      );
      return item
        ? {
            ok: true,
            value: {
              sessionId: state.sessionId,
              revision: state.revision,
              item,
            },
          }
        : {
            ok: false,
            error: { code: "NOT_FOUND", message: "Timeline item not found." },
          };
    }
    if (request.endUs <= request.startUs)
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "Timeline range must have a positive duration.",
        },
      };
    const matching = items.filter(
      (item) =>
        timelineStartUs(item) < request.endUs &&
        timelineEndUs(item) > request.startUs,
    );
    return {
      ok: true,
      value: {
        sessionId: state.sessionId,
        revision: state.revision,
        items: matching.slice(request.offset, request.offset + request.limit),
        total: matching.length,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error instanceof EditingError ? error.code : "INVALID_INPUT",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
