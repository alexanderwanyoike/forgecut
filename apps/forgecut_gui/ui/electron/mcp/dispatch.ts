import { isAbsolute } from "node:path";
import { z } from "zod";
import type { GraphicComponent } from "../shared/graphics.js";
import { resolveSequenceFrame } from "../domain/sequence.js";
import { ensureForgeCutExtension } from "../backend/state.js";
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
} from "../domain/timeline-item.js";
import { EditingError } from "../backend/editing-error.js";
import type { BridgeResult } from "./contract.js";
import {
  importRequestSchema,
  jobRequestSchema,
  frameRequestSchema,
  exportRequestSchema,
} from "./job-schema.js";
import { startMediaJob } from "../backend/media-jobs.js";
import { startExportJob } from "../backend/export-jobs.js";

export const pageFields = {
  sessionId: idSchema,
  offset: timeSchema.default(0),
  limit: z.number().int().min(1).max(100).default(50),
};
export const projectFileRequestSchema = z.strictObject({
  sessionId: idSchema,
  expectedRevision: timeSchema,
  path: z
    .string()
    .min(1)
    .max(4096)
    .refine(isAbsolute, "Use an absolute project path"),
});
export const bridgeRequestSchema = z.discriminatedUnion("action", [
  exportRequestSchema.extend({ action: z.literal("export") }),
  frameRequestSchema.extend({ action: z.literal("frame") }),
  importRequestSchema.extend({ action: z.literal("import") }),
  jobRequestSchema.extend({ action: z.literal("job") }),
  jobRequestSchema.extend({ action: z.literal("cancel") }),
  z.strictObject({ action: z.literal("summary") }),
  z.strictObject({ action: z.literal("context"), sessionId: idSchema }),
  z.strictObject({ action: z.literal("templates"), sessionId: idSchema }),
  z.strictObject({
    action: z.literal("component"),
    sessionId: idSchema,
    componentId: idSchema,
    version: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  projectFileRequestSchema.extend({ action: z.literal("save") }),
  projectFileRequestSchema.extend({ action: z.literal("open") }),
  z.strictObject({
    action: z.literal("history"),
    request: historyRequestSchema,
  }),
  z.strictObject({ action: z.literal("assets"), ...pageFields }),
  z.strictObject({
    action: z.literal("sequence"),
    ...pageFields,
    playheadUs: timeSchema,
  }),
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
    if (request.action === "export")
      return startExportJob(state, service.jobs, request);
    if (request.action === "job")
      return service.jobs.read(request.jobId, request.sessionId);
    if (request.action === "cancel")
      return service.jobs.cancel(request.jobId, request.sessionId);
    if (request.action === "import" || request.action === "frame") {
      return startMediaJob(service, request);
    }
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
    if (request.action === "templates") {
      const result = await service.execute("get_graphic_components");
      if (!result.ok) return result;
      state.assertSession(request.sessionId);
      return {
        ok: true,
        value: {
          sessionId: state.sessionId,
          templates: (result.value as GraphicComponent[]).map(
            componentMetadata,
          ),
        },
      };
    }
    if (request.action === "component") {
      const component = state.project.components?.find(
        (candidate) =>
          candidate.id === request.componentId &&
          candidate.version === request.version,
      );
      if (!component)
        return {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "Graphic component version not found.",
          },
        };
      return {
        ok: true,
        value: {
          sessionId: state.sessionId,
          revision: state.revision,
          component: componentMetadata(component),
        },
      };
    }
    if (request.action === "sequence") {
      const { layers, ...frame } = resolveSequenceFrame(
        state.project,
        request.playheadUs,
      );
      return {
        ok: true,
        value: {
          sessionId: state.sessionId,
          revision: state.revision,
          ...frame,
          layers: layers.slice(request.offset, request.offset + request.limit),
          total: layers.length,
        },
      };
    }
    if (request.action === "context")
      return { ok: true, value: state.getEditingContext() };
    if (request.action === "save" || request.action === "open") {
      if (request.expectedRevision !== state.revision)
        return {
          ok: false,
          error: {
            code: "CONFLICT",
            message:
              "The project changed. Read it again before using project files.",
          },
        };
      if (request.action === "save") {
        const { revision } = state;
        const path = ensureForgeCutExtension(request.path);
        await state.saveProject(path);
        return {
          ok: true,
          value: { saved: true, path, sessionId: request.sessionId, revision },
        };
      }
      await state.loadProject(request.path);
      return { ok: true, value: summary(state) };
    }
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
    let code = "INVALID_INPUT";
    if (error instanceof EditingError) code = error.code;
    else if (error instanceof Error && "code" in error) code = "IO_ERROR";
    return {
      ok: false,
      error: {
        code,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function componentMetadata(component: GraphicComponent) {
  return {
    id: component.id,
    template_id: component.template_id,
    version: component.version,
    name: component.name,
    design_size: component.design_size,
    properties: component.properties,
    layers: component.layers,
    dependencies: component.dependencies,
  };
}
