import { z } from "zod";
import type { CommandName, EditCommandName } from "../shared/ipc-contract.js";
import { idSchema as id, timeSchema as time, settingsSchema, trackKindSchema } from "./project-schema.js";

const nonempty = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape).refine((value) => Object.keys(value).length > 0, "At least one property is required");
const patch = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("AudioClip"), changes: nonempty({ volume: z.number().min(0).max(4).optional() }) }),
  z.strictObject({ kind: z.literal("TextOverlay"), changes: nonempty({
    text: z.string().optional(), font_size: z.number().positive().optional(),
    color: z.string().regex(/^#[\da-f]{6}([\da-f]{2})?$/i).optional(), x: z.number().optional(), y: z.number().optional(),
  }) }),
  z.strictObject({ kind: z.literal("ImageOverlay"), changes: nonempty({
    asset_id: id.optional(), x: z.number().optional(), y: z.number().optional(),
    width: z.number().positive().optional(), height: z.number().positive().optional(), opacity: z.number().min(0).max(1).optional(),
  }) }),
]);
const none = z.strictObject({}).optional();
export const editSchemas = {
  add_clip_to_timeline: z.strictObject({ assetId: id, trackId: id, timelineStartUs: time }),
  trim_clip: z.strictObject({ itemId: id, trimType: z.enum(["in", "out"]), newUs: time }),
  split_clip: z.strictObject({ itemId: id, splitTimeUs: time }),
  delete_clip: z.strictObject({ itemId: id }),
  move_clip: z.strictObject({ itemId: id, newStartUs: time }),
  move_clip_to_track: z.strictObject({ itemId: id, newTrackId: id, newStartUs: time }),
  add_track: z.strictObject({ kind: trackKindSchema }),
  add_text_overlay: z.strictObject({ trackId: id, timelineStartUs: time, durationUs: time.positive(), text: z.string().min(1), fontSize: z.number().positive(), color: z.string(), x: z.number(), y: z.number() }),
  add_image_overlay: z.strictObject({ assetId: id, timelineStartUs: time, durationUs: time.positive(), x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), opacity: z.number().min(0).max(1) }),
  set_clip_volume: z.strictObject({ itemId: id, volume: z.number().min(0).max(4) }),
  update_item: z.strictObject({ itemId: id, patch }),
  remove_asset: z.strictObject({ id }),
  update_project: nonempty({ name: z.string().optional(), settings: settingsSchema.partial().refine((value) => Object.keys(value).length > 0).optional() }),
} satisfies Record<EditCommandName, z.ZodType>;

export const editRequestSchema = z.strictObject({
  sessionId: id, expectedRevision: time, requestId: id, editGroup: id.optional(),
  operations: z.array(z.strictObject({ command: z.enum(Object.keys(editSchemas) as [EditCommandName, ...EditCommandName[]]), args: z.record(z.string(), z.unknown()) })).min(1).max(100),
});
export const metadataSchema = z.strictObject({ sessionId: id.optional(), editGroup: id.optional() }).optional();
export const commandSchemas = {
  ...editSchemas,
  create_project: none, save_project: z.strictObject({ path: z.string().min(1) }),
  load_project: z.strictObject({ path: z.string().min(1) }), recover_project: z.strictObject({ path: z.string().min(1) }),
  get_project_settings: none, get_project_snapshot: none, apply_edits: editRequestSchema,
  autosave: none, get_timeline: none, init_default_tracks: none, undo: none, redo: none,
  get_snap_points: z.strictObject({ excludeItemId: id.optional() }),
  get_clip_at_playhead: z.strictObject({ playheadUs: time }), get_overlays_at_time: z.strictObject({ playheadUs: time }),
  get_item_details: z.strictObject({ itemId: id }),
  import_assets: z.strictObject({ paths: z.array(z.string().min(1)).min(1).max(100) }), get_assets: none,
  relink_asset: z.strictObject({ id, path: z.string().min(1) }),
  get_clip_thumbnails: z.strictObject({ assetId: id }), get_waveform: z.strictObject({ assetId: id }),
  export_project: z.strictObject({ outputPath: z.string().min(1) }),
} satisfies Record<CommandName, z.ZodType>;
