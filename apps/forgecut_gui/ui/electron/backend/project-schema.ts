import { z } from "zod";
import type { Project } from "../shared/ipc-contract.js";
import {
  durationUs,
  itemData,
  itemVariant,
  timelineEndUs,
  timelineStartUs,
} from "./timeline-ops.js";

import {
  graphicComponentSchema,
  graphicValuesSchema,
} from "./graphic-schema.js";
import { validateProjectGraphics } from "./project-graphics.js";

export const idSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-z\d][a-z\d_.:-]*$/i);
export const timeSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const positive = z.number().positive();
export const settingsSchema = z.strictObject({
  width: positive.int().max(16384),
  height: positive.int().max(16384),
  fps: positive.max(1000),
  sample_rate: positive.int().max(384000),
});
const position = { x: z.number(), y: z.number() };
export const audioSettingsShape = {
  volume: z.number().min(0).max(4).optional(),
  muted: z.boolean().optional(),
  fade_in_us: timeSchema.optional(),
  fade_out_us: timeSchema.optional(),
};
export const layerOrderSchema = z.number().int();
export const fitSchema = z.enum(["contain", "cover"]);
export const visualPlacementSchema = z.strictObject({
  ...position,
  width: positive,
  height: positive,
  opacity: z.number().min(0).max(1),
  fit: fitSchema,
});
const clip = z.strictObject({
  id: idSchema,
  asset_id: idSchema,
  track_id: idSchema,
  timeline_start_us: timeSchema,
  source_in_us: timeSchema,
  source_out_us: timeSchema,
  ...audioSettingsShape,
});
const image = z.strictObject({
  fit: fitSchema.optional(),
  layer_order: layerOrderSchema.optional(),
  id: idSchema,
  asset_id: idSchema,
  track_id: idSchema,
  timeline_start_us: timeSchema,
  duration_us: timeSchema.positive(),
  ...position,
  width: positive,
  height: positive,
  opacity: z.number().min(0).max(1),
});
const text = z.strictObject({
  layer_order: layerOrderSchema.optional(),
  id: idSchema,
  track_id: idSchema,
  timeline_start_us: timeSchema,
  duration_us: timeSchema.positive(),
  text: z.string(),
  font_size: positive,
  color: z.string().regex(/^#[\da-f]{6}([\da-f]{2})?$/i),
  ...position,
});
export const trackKindSchema = z.enum([
  "Video",
  "Audio",
  "OverlayImage",
  "OverlayText",
  "Graphics",
]);
export const assetSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  path: z.string().min(1),
  kind: z.enum(["Video", "Audio", "Image"]),
  probe: z
    .strictObject({
      duration_us: timeSchema,
      width: timeSchema,
      height: timeSchema,
      fps: z.number().nonnegative(),
      codec: z.string(),
      audio_channels: timeSchema,
      audio_sample_rate: timeSchema,
    })
    .nullable(),
});
const projectSchema = z.strictObject({
  schema_version: z
    .union([z.literal(1), z.literal(2)])
    .default(1)
    .transform(() => 2 as const),
  components: z.array(graphicComponentSchema).max(100).default([]),
  id: idSchema,
  name: z.string(),
  settings: settingsSchema,
  assets: z.array(assetSchema),
  timeline: z.strictObject({
    duration_us: timeSchema.positive().optional(),
    tracks: z.array(
      z.strictObject({
        id: idSchema,
        kind: trackKindSchema,
        items: z.array(
          z.union([
            z.strictObject({
              VideoClip: clip.extend({
                transform: visualPlacementSchema.optional(),
                layer_order: layerOrderSchema.optional(),
              }),
            }),
            z.strictObject({
              AudioClip: clip.extend({
                volume: z.number().nonnegative().max(4),
              }),
            }),
            z.strictObject({ ImageOverlay: image }),
            z.strictObject({ TextOverlay: text }),
            z.strictObject({
              RemotionGraphic: z.strictObject({
                id: idSchema,
                track_id: idSchema,
                timeline_start_us: timeSchema,
                duration_us: timeSchema.positive(),
                component_id: idSchema,
                component_version: z.string().regex(/^[a-f0-9]{64}$/),
                props: graphicValuesSchema,
                transform: visualPlacementSchema.optional(),
                layer_order: layerOrderSchema.optional(),
              }),
            }),
          ]),
        ),
      }),
    ),
    markers: z.array(z.object({ time_us: timeSchema }).passthrough()),
  }),
});

export function validateProject(input: unknown): Project {
  const project = projectSchema.parse(input);
  const ids = new Set<string>();
  const unique = (id: string) => {
    if (ids.has(id)) throw new Error(`Duplicate ID: ${id}`);
    ids.add(id);
  };
  unique(project.id);
  project.assets.forEach((asset) => unique(asset.id));
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const kinds = {
    VideoClip: "Video",
    AudioClip: "Audio",
    ImageOverlay: "OverlayImage",
    TextOverlay: "OverlayText",
    RemotionGraphic: "Graphics",
  };
  for (const track of project.timeline.tracks) {
    unique(track.id);
    for (const item of track.items) {
      const data = itemData(item);
      unique(data.id);
      if (
        data.track_id !== track.id ||
        kinds[itemVariant(item)] !== track.kind
      ) {
        throw new Error(`Item ${data.id} is incompatible with its track`);
      }
      if (durationUs(item) <= 0 || !Number.isSafeInteger(timelineEndUs(item))) {
        throw new Error(`Invalid duration for item ${data.id}`);
      }
      if ("asset_id" in data) {
        const asset = assets.get(data.asset_id);
        if (!asset)
          throw new Error(`Missing asset reference: ${data.asset_id}`);
        let expected = "Video";
        if ("ImageOverlay" in item) expected = "Image";
        else if ("AudioClip" in item) expected = "Audio";
        if (asset.kind !== expected)
          throw new Error(`Incompatible asset for item ${data.id}`);
        if (
          "source_out_us" in data &&
          asset.probe &&
          asset.probe.duration_us > 0 &&
          data.source_out_us > asset.probe.duration_us
        ) {
          throw new Error(`Item ${data.id} exceeds the source duration`);
        }
      }
    }
    const sorted = [...track.items].sort(
      (a, b) => timelineStartUs(a) - timelineStartUs(b),
    );
    for (let i = 1; i < sorted.length; i += 1) {
      if (timelineStartUs(sorted[i]) < timelineEndUs(sorted[i - 1]))
        throw new Error("Overlap detected");
    }
  }
  validateProjectGraphics(project);
  return project;
}
