import { z } from "zod";
import {
  MIN_REVIEW_DURATION_US,
  MAX_REVIEW_DURATION_US,
} from "../domain/review-range.js";
import { graphicPropertiesSchema } from "../shared/graphic-property-schema.js";
import { graphicSourceSchema } from "../shared/graphic-source-schema.js";
import {
  resourceImportSchema,
  resourceLicenseSchema,
} from "./graphic-resource-schema.js";
import type { CommandName, EditCommandName } from "../shared/ipc-contract.js";
import {
  idSchema as id,
  timeSchema as time,
  settingsSchema,
  trackKindSchema,
  audioSettingsShape,
  visualPlacementSchema,
  layerOrderSchema,
  fitSchema,
} from "./project-schema.js";

import {
  graphicComponentSchema,
  graphicValuesSchema,
  graphicLayerStatesSchema,
} from "./graphic-schema.js";

const nonempty = <T extends z.ZodRawShape>(shape: T) =>
  z
    .strictObject(shape)
    .refine(
      (value) => Object.keys(value).length > 0,
      "At least one property is required",
    );
const patch = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("RemotionGraphic"),
    changes: nonempty({
      props: graphicValuesSchema.optional(),
      layer_states: graphicLayerStatesSchema.optional(),
      transform: visualPlacementSchema.optional(),
      layer_order: layerOrderSchema.optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal("VideoClip"),
    changes: nonempty({
      ...audioSettingsShape,
      transform: visualPlacementSchema.optional(),
      layer_order: layerOrderSchema.optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal("AudioClip"),
    changes: nonempty(audioSettingsShape),
  }),
  z.strictObject({
    kind: z.literal("TextOverlay"),
    changes: nonempty({
      layer_order: layerOrderSchema.optional(),
      text: z.string().optional(),
      font_size: z.number().positive().optional(),
      color: z
        .string()
        .regex(/^#[\da-f]{6}([\da-f]{2})?$/i)
        .optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal("ImageOverlay"),
    changes: nonempty({
      layer_order: layerOrderSchema.optional(),
      fit: fitSchema.optional(),
      asset_id: id.optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      opacity: z.number().min(0).max(1).optional(),
    }),
  }),
]);
const none = z.strictObject({}).optional();
export const editSchemas = {
  set_resource_license: z.strictObject({
    resourceId: id,
    license: resourceLicenseSchema,
  }),
  set_asset_license: z.strictObject({
    assetId: id,
    license: resourceLicenseSchema.nullable(),
  }),
  delete_style_preset: z.strictObject({ presetId: id }),
  save_style_preset: z.strictObject({
    presetId: id.optional(),
    sourceSequenceId: id,
    itemId: id,
    name: z.string().trim().min(1).max(200),
    purpose: z.enum(["card", "ending"]),
  }),
  add_graphic_from_preset: z.strictObject({
    presetId: id,
    trackId: id,
    timelineStartUs: time,
    durationUs: time.positive(),
    overrides: graphicValuesSchema.optional(),
  }),
  update_source_selection: z.strictObject({
    selectionId: id,
    patch: nonempty({
      name: z.string().trim().min(1).max(200).optional(),
      source_in_us: time.optional(),
      source_out_us: time.optional(),
      notes: z.string().max(2000).optional(),
      rationale: z.string().max(2000).optional(),
    }),
  }),
  create_sequence_variant: z.strictObject({
    sourceSequenceId: id,
    name: z.string().trim().min(1).max(200),
    settings: settingsSchema.partial().optional(),
  }),
  sync_variant_timing: z.strictObject({ itemIds: z.array(id).min(1).max(100) }),
  save_source_selection: z
    .strictObject({
      selectionId: id.optional(),
      assetId: id,
      name: z.string().trim().min(1).max(200),
      sourceInUs: time,
      sourceOutUs: time,
      notes: z.string().max(2000),
      rationale: z.string().max(2000),
    })
    .refine(
      (selection) => selection.sourceOutUs > selection.sourceInUs,
      "Source selection must have a positive duration",
    ),
  delete_source_selection: z.strictObject({ selectionId: id }),
  delete_sequence: z.strictObject({ sequenceId: id }),
  rename_sequence: z.strictObject({
    sequenceId: id,
    name: z.string().trim().min(1).max(200),
  }),
  create_sequence: z.strictObject({
    name: z.string().trim().min(1).max(200),
    settings: settingsSchema.partial().optional(),
  }),
  add_graphic_item: z.strictObject({
    templateId: id,
    trackId: id,
    timelineStartUs: time,
    durationUs: time.positive(),
    props: graphicValuesSchema.optional(),
  }),
  set_sequence_end: z.strictObject({ endUs: time.positive().nullable() }),
  add_clip_to_timeline: z.strictObject({
    assetId: id,
    trackId: id,
    timelineStartUs: time,
    sourceInUs: time.optional(),
    sourceOutUs: time.optional(),
  }),
  trim_clip: z.strictObject({
    itemId: id,
    trimType: z.enum(["in", "out"]),
    newUs: time,
  }),
  split_clip: z.strictObject({ itemId: id, splitTimeUs: time }),
  delete_clip: z.strictObject({ itemId: id }),
  move_clip: z.strictObject({ itemId: id, newStartUs: time }),
  move_clip_to_track: z.strictObject({
    itemId: id,
    newTrackId: id,
    newStartUs: time,
  }),
  add_track: z.strictObject({ kind: trackKindSchema }),
  add_text_overlay: z.strictObject({
    trackId: id,
    timelineStartUs: time,
    durationUs: time.positive(),
    text: z.string().min(1),
    fontSize: z.number().positive(),
    color: z.string(),
    x: z.number(),
    y: z.number(),
  }),
  add_image_overlay: z.strictObject({
    assetId: id,
    timelineStartUs: time,
    durationUs: time.positive(),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    opacity: z.number().min(0).max(1),
  }),
  set_clip_volume: z.strictObject({
    itemId: id,
    volume: z.number().min(0).max(4),
  }),
  update_item: z.strictObject({ itemId: id, patch }),
  remove_asset: z.strictObject({ id }),
  update_project: nonempty({
    name: z.string().optional(),
    settings: settingsSchema
      .partial()
      .refine((value) => Object.keys(value).length > 0)
      .optional(),
  }),
} satisfies Record<EditCommandName, z.ZodType>;

export const editRequestSchema = z.strictObject({
  sequenceId: id.optional(),
  sessionId: id,
  expectedRevision: time,
  requestId: id,
  editGroup: id.optional(),
  operations: z
    .array(
      z.strictObject({
        command: z.enum(
          Object.keys(editSchemas) as [EditCommandName, ...EditCommandName[]],
        ),
        args: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1)
    .max(100),
});
export const historyRequestSchema = z.strictObject({
  sequenceId: id.optional(),
  sessionId: id,
  expectedRevision: time,
  requestId: id,
  direction: z.enum(["undo", "redo"]),
});
export const metadataSchema = z
  .strictObject({
    sessionId: id.optional(),
    editGroup: id.optional(),
    sequenceId: id.optional(),
  })
  .optional();
const stableMappings = z
  .record(z.uuid(), z.uuid().nullable())
  .refine((value) => Object.keys(value).length <= 100);
const graphicSourceTargetFields = {
  itemId: id,
  sessionId: z.uuid(),
  expectedRevision: time,
  expectedDraftRevision: time,
  mappings: z
    .strictObject({
      properties: stableMappings.optional(),
      layers: stableMappings.optional(),
    })
    .optional(),
};
export const sourceReviewRequestSchema = z
  .strictObject({
    sessionId: id,
    expectedRevision: time,
    requestId: id,
    assetId: id,
    startUs: time,
    endUs: time,
    kind: z.enum(["contact-sheet", "waveform", "preview"]),
  })
  .refine(
    (request) =>
      request.endUs - request.startUs >= 100000 &&
      request.endUs - request.startUs <=
        (request.kind === "preview" ? 5000000 : 30000000),
    "Review 100 milliseconds to 30 seconds; previews are limited to 5 seconds",
  );
export const reviewRangeSchema = z
  .strictObject({ startUs: time, endUs: time })
  .refine(
    (range) =>
      range.endUs - range.startUs >= MIN_REVIEW_DURATION_US &&
      range.endUs - range.startUs <= MAX_REVIEW_DURATION_US,
    "Choose a review range between 0.1 and 30 seconds",
  );
export const commandSchemas = {
  start_source_review: sourceReviewRequestSchema,
  get_graphic_type_libraries: none,
  get_graphic_draft_preview: z.strictObject({
    ...graphicSourceTargetFields,
    frame: time,
  }),
  start_graphic_promotion: z.strictObject({
    ...graphicSourceTargetFields,
    requestId: z.uuid(),
    scope: z.enum(["instance", "shared"]).optional(),
  }),
  get_graphic_draft: z.strictObject({ itemId: id }),
  save_graphic_draft: z.strictObject({
    itemId: id,
    sessionId: z.uuid(),
    expectedDraftRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER - 2),
    baseVersion: z.string().regex(/^[a-f0-9]{64}$/),
    component: graphicComponentSchema,
  }),
  revert_graphic_draft: z.strictObject({
    itemId: id,
    sessionId: z.uuid(),
    expectedDraftRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER - 2),
  }),
  get_graphic_preview: z.strictObject({
    itemId: id,
    frame: time,
    props: graphicValuesSchema.optional(),
  }),
  check_graphic_source: z.strictObject({
    properties: graphicPropertiesSchema.optional(),
    source: graphicSourceSchema,
  }),
  import_graphic_resource: resourceImportSchema,
  get_graphic_components: none,
  ...editSchemas,
  create_project: none,
  save_project: z.strictObject({ path: z.string().min(1) }),
  load_project: z.strictObject({ path: z.string().min(1) }),
  recover_project: z.strictObject({ path: z.string().min(1) }),
  get_project_settings: none,
  get_project_snapshot: none,
  get_sequences: none,
  get_sequence_timeline: z.strictObject({ sequenceId: id }),
  select_sequence: z.strictObject({ sessionId: id, sequenceId: id }),
  get_editing_context: none,
  set_editing_context: z.strictObject({
    sequenceRevision: time.optional(),
    sequenceId: id.optional(),
    sessionId: id,
    selectedItemIds: z.array(id).max(100),
    selectedLayerIds: z.array(z.uuid()).max(100).optional(),
    playheadUs: time,
  }),
  apply_edits: editRequestSchema,
  apply_history: historyRequestSchema,
  autosave: none,
  get_timeline: none,
  init_default_tracks: none,
  undo: none,
  redo: none,
  get_snap_points: z.strictObject({ excludeItemId: id.optional() }),
  get_sequence_frame: z.strictObject({ playheadUs: time }),
  get_item_details: z.strictObject({ itemId: id }),
  import_assets: z.strictObject({
    paths: z.array(z.string().min(1)).min(1).max(100),
  }),
  get_assets: none,
  relink_asset: z.strictObject({ id, path: z.string().min(1) }),
  get_clip_thumbnails: z.strictObject({ assetId: id }),
  get_waveform: z.strictObject({ assetId: id }),
  cancel_media_job: z.strictObject({ sessionId: id, jobId: z.uuid() }),
  get_media_job: z.strictObject({ sessionId: id, jobId: z.uuid() }),
  export_project: z.strictObject({
    range: reviewRangeSchema.optional(),
    outputPath: z.string().min(1),
    sequenceId: id.optional(),
  }),
} satisfies Record<CommandName, z.ZodType>;
