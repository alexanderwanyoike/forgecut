import { batchActionSchemas } from "./batch-schema.js";
import { dispatchBatchAction } from "./batch-actions.js";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { stylePropertyPageFields } from "./style-schema.js";
import { sourceActionSchemas } from "./draft-schema.js";
import { dispatchGraphicSource } from "./source-actions.js";
import { sourceCheckRequestSchema } from "./source-schema.js";
import type { GraphicComponent } from "../shared/graphics.js";
import { projectSequences } from "../domain/project-sequences.js";
import { dispatchSequenceAction } from "./sequence-actions.js";
import { sequenceActionSchemas } from "./sequence-schema.js";
import { pageFields, resourcePageFields } from "./page-schema.js";
import { ensureForgeCutExtension } from "../backend/state.js";
import type { EditingService } from "../backend/editing-service.js";
import type {
  EditingContext,
  ProjectSnapshot,
} from "../shared/ipc-contract.js";
import {
  sourceReviewRequestSchema,
  editRequestSchema,
  historyRequestSchema,
} from "../backend/command-schema.js";
import { idSchema, timeSchema } from "../backend/project-schema.js";
import { EditingError } from "../backend/editing-error.js";
import type { BridgeResult } from "./contract.js";
import {
  resourceRequestSchema,
  importRequestSchema,
  jobRequestSchema,
  frameRequestSchema,
  exportRequestSchema,
} from "./job-schema.js";
import { startMediaJob } from "../backend/media-jobs.js";
import { startExportJob } from "../backend/export-jobs.js";

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
  ...batchActionSchemas,
  ...sourceActionSchemas,
  z.strictObject({
    action: z.literal("source-review"),
    request: sourceReviewRequestSchema,
  }),
  ...sequenceActionSchemas,
  sourceCheckRequestSchema.extend({ action: z.literal("source-check") }),
  resourceRequestSchema.extend({ action: z.literal("resource") }),
  z.strictObject({
    action: z.literal("asset-credit"),
    sessionId: idSchema,
    assetId: idSchema,
  }),
  z.strictObject({ action: z.literal("resources"), ...resourcePageFields }),
  z.strictObject({
    action: z.literal("resource-details"),
    sessionId: idSchema,
    resourceId: idSchema,
  }),
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
  z.strictObject({ action: z.literal("style-presets"), ...resourcePageFields }),
  z.strictObject({
    action: z.literal("style-preset-values"),
    ...stylePropertyPageFields,
  }),
  z.strictObject({
    action: z.literal("source-selections"),
    ...resourcePageFields,
    assetId: idSchema.optional(),
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
function summary(
  source: SummarySource,
  context: Pick<EditingContext, "activeSequenceId" | "sequenceRevision">,
) {
  return {
    projectId: source.project.id,
    sessionId: source.sessionId,
    revision: source.revision,
    name: source.project.name.slice(0, 512),
    settings: source.project.settings,
    sequenceCount: projectSequences(source.project).length,
    defaultSequenceId: source.project.default_sequence?.id ?? source.project.id,
    activeSequenceId: context.activeSequenceId,
    sequenceRevision: context.sequenceRevision,
    assetCount: source.project.assets.length,
    resourceCount: source.project.resources?.length ?? 0,
    stylePresetCount: source.project.style_presets?.length ?? 0,
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
    if (
      request.action === "create-batch" ||
      request.action === "read-batch" ||
      request.action === "resume-batch" ||
      request.action === "cancel-batch"
    )
      return await dispatchBatchAction(service, request);
    if (
      request.action === "source-read" ||
      request.action === "draft-file" ||
      request.action === "draft-save" ||
      request.action === "draft-revert" ||
      request.action === "source-promote"
    )
      return await dispatchGraphicSource(service, request);
    if (request.action === "source-review") {
      const response = await service.execute(
        "start_source_review",
        request.request,
      );
      return response.ok ? { ok: true, value: response.value } : response;
    }
    if (request.action === "export")
      return startExportJob(state, service.jobs, request);
    if (request.action === "job")
      return service.jobs.read(request.jobId, request.sessionId);
    if (request.action === "cancel")
      return service.jobs.cancel(request.jobId, request.sessionId);
    if (
      request.action === "import" ||
      request.action === "frame" ||
      request.action === "resource" ||
      request.action === "source-check"
    ) {
      return startMediaJob(service, request);
    }
    if (request.action === "summary")
      return { ok: true, value: summary(state, state.getEditingContext()) };
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
          ...summary(snapshot, snapshot),
          changedItemIds: snapshot.changedItemIds ?? [],
        },
      };
    }
    state.assertSession(request.sessionId);
    if (
      request.action === "sequences" ||
      request.action === "select-sequence" ||
      request.action === "sequence" ||
      request.action === "timeline" ||
      request.action === "item"
    )
      return dispatchSequenceAction(state, request);
    if (request.action === "asset-credit") {
      const asset = state.project.assets.find(
        (value) => value.id === request.assetId,
      );
      return asset
        ? {
            ok: true,
            value: {
              sessionId: state.sessionId,
              revision: state.revision,
              assetId: asset.id,
              license: asset.license ?? null,
            },
          }
        : {
            ok: false,
            error: { code: "NOT_FOUND", message: "Asset not found" },
          };
    }
    if (request.action === "style-preset-values") {
      const preset = state.project.style_presets?.find(
        (value) => value.id === request.presetId,
      );
      if (!preset)
        return {
          ok: false,
          error: { code: "NOT_FOUND", message: "Style preset not found" },
        };
      const entries = Object.entries(preset.props);
      return {
        ok: true,
        value: {
          sessionId: state.sessionId,
          revision: state.revision,
          presetId: preset.id,
          total: entries.length,
          props: Object.fromEntries(
            entries.slice(request.offset, request.offset + request.limit),
          ),
        },
      };
    }
    if (request.action === "style-presets") {
      const presets = state.project.style_presets ?? [];
      return {
        ok: true,
        value: {
          sessionId: state.sessionId,
          revision: state.revision,
          total: presets.length,
          presets: presets
            .slice(request.offset, request.offset + request.limit)
            .map(
              ({
                id,
                name,
                purpose,
                canvas_size,
                component_id,
                component_version,
                layer_states,
                transform,
              }) => ({
                id,
                name,
                purpose,
                canvas_size,
                component_id,
                component_version,
                ...(layer_states ? { layer_states } : {}),
                ...(transform ? { transform } : {}),
              }),
            ),
        },
      };
    }
    if (request.action === "source-selections") {
      if (
        request.assetId &&
        !state.project.assets.some((asset) => asset.id === request.assetId)
      )
        return {
          ok: false,
          error: { code: "NOT_FOUND", message: "Source asset not found" },
        };
      const selections = (state.project.source_selections ?? []).filter(
        (selection) =>
          !request.assetId || selection.asset_id === request.assetId,
      );
      return {
        ok: true,
        value: {
          sessionId: state.sessionId,
          revision: state.revision,
          total: selections.length,
          selections: selections.slice(
            request.offset,
            request.offset + request.limit,
          ),
        },
      };
    }
    if (request.action === "resources") {
      const resources = state.project.resources ?? [];
      return {
        ok: true,
        value: {
          sessionId: state.sessionId,
          revision: state.revision,
          total: resources.length,
          resources: resources
            .slice(request.offset, request.offset + request.limit)
            .map(({ license, ...resource }) => ({
              ...resource,
              license: {
                identifier: license.identifier,
                attribution: license.attribution,
                source_url: license.source_url,
              },
            })),
        },
      };
    }
    if (request.action === "resource-details") {
      const resource = state.project.resources?.find(
        (candidate) => candidate.id === request.resourceId,
      );
      return resource
        ? {
            ok: true,
            value: {
              sessionId: state.sessionId,
              revision: state.revision,
              resource,
            },
          }
        : {
            ok: false,
            error: { code: "NOT_FOUND", message: "Graphic resource not found" },
          };
    }
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
      return { ok: true, value: summary(state, state.getEditingContext()) };
    }
    return {
      ok: true,
      value: {
        sessionId: state.sessionId,
        revision: state.revision,
        assets: state.project.assets
          .slice(request.offset, request.offset + request.limit)
          .map(({ license, ...asset }) => ({
            ...asset,
            ...(license
              ? {
                  license: {
                    identifier: license.identifier,
                  },
                }
              : {}),
          })),
        total: state.project.assets.length,
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
