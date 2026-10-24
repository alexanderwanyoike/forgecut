import { randomUUID } from "node:crypto";
import { lockedGraphicProperties } from "../../domain/graphic-layer-locks.js";
import { EditingError } from "../editing-error.js";
import { resolveSequenceFrame } from "../../domain/sequence.js";
import type { Asset, TimelineItem, Track } from "../state.js";
import type { ItemPatch } from "../../shared/ipc-contract.js";
import {
  addItem,
  assetIdOf,
  collectSnapPoints,
  findItem,
  itemData,
  moveItem,
  moveItemToTrack,
  removeItem,
  splitAt,
  trimIn,
  trimOut,
} from "../timeline-ops.js";
import {
  optionalString,
  requiredNumber,
  requiredString,
  type CommandRegistry,
} from "./types.js";

export const timelineCommands = {
  set_sequence_end: (args, { state }) =>
    state.executeTimelineChange((timeline) => {
      if (args?.endUs === null) delete timeline.duration_us;
      else timeline.duration_us = requiredNumber(args, "endUs");
    }),
  get_timeline: (_args, { state }) => state.activeSequence.timeline,
  init_default_tracks: (_args, { state }) => state.initDefaultTracks(),
  add_clip_to_timeline: (args, { state }) =>
    state.executeTimelineChange((timeline) => {
      const assetId = requiredString(args, "assetId");
      const trackId = requiredString(args, "trackId");
      const timelineStartUs = requiredNumber(args, "timelineStartUs");
      const asset = requireAsset(state.project.assets, assetId);
      addItem(
        timeline,
        trackId,
        createTimelineItem(asset, trackId, timelineStartUs, {
          inUs: args?.sourceInUs as number | undefined,
          outUs: args?.sourceOutUs as number | undefined,
        }),
      );
    }),
  trim_clip: (args, { state }) =>
    state.executeTimelineChange((timeline) => {
      const trimType = requiredString(args, "trimType");
      const itemId = requiredString(args, "itemId");
      const newUs = requiredNumber(args, "newUs");
      if (trimType === "in") {
        trimIn(timeline, itemId, newUs);
      } else if (trimType === "out") {
        trimOut(timeline, itemId, newUs);
      } else {
        throw new Error("Unknown trim type");
      }
    }),
  split_clip: (args, { state }) =>
    state.executeTimelineChange((timeline) => {
      splitAt(
        timeline,
        requiredString(args, "itemId"),
        requiredNumber(args, "splitTimeUs"),
      );
    }),
  delete_clip: (args, { state }) =>
    state.executeTimelineChange((timeline) => {
      removeItem(timeline, requiredString(args, "itemId"));
    }),
  move_clip: (args, { state }) =>
    state.executeTimelineChange((timeline) => {
      moveItem(
        timeline,
        requiredString(args, "itemId"),
        requiredNumber(args, "newStartUs"),
      );
    }),
  move_clip_to_track: (args, { state }) =>
    state.executeTimelineChange((timeline) => {
      moveItemToTrack(
        timeline,
        requiredString(args, "itemId"),
        requiredString(args, "newTrackId"),
        requiredNumber(args, "newStartUs"),
      );
    }),
  undo: (_args, { state }) => state.undo(),
  redo: (_args, { state }) => state.redo(),
  add_track: (args, { state }) =>
    state.executeTimelineChange((timeline) => {
      const kind = requiredString(args, "kind") as Track["kind"];
      if (
        !["Video", "Audio", "OverlayImage", "OverlayText", "Graphics"].includes(
          kind,
        )
      ) {
        throw new Error(`Unknown track kind: ${kind}`);
      }
      timeline.tracks.push({ id: randomUUID(), kind, items: [] });
    }),
  add_text_overlay: (args, { state }) =>
    state.executeTimelineChange((timeline) => {
      const trackId = requiredString(args, "trackId");
      ensureTrack(timeline.tracks, trackId, "OverlayText");
      const overlayTrack = timeline.tracks.find(
        (track) => track.id === trackId && track.kind === "OverlayText",
      );
      if (!overlayTrack) throw new Error("OverlayText track not found");

      addItem(timeline, overlayTrack.id, {
        TextOverlay: {
          id: randomUUID(),
          track_id: overlayTrack.id,
          timeline_start_us: requiredNumber(args, "timelineStartUs"),
          duration_us: requiredNumber(args, "durationUs"),
          text: requiredString(args, "text"),
          font_size: requiredNumber(args, "fontSize"),
          color: requiredString(args, "color"),
          x: requiredNumber(args, "x"),
          y: requiredNumber(args, "y"),
        },
      });
    }),
  add_image_overlay: (args, { state }) =>
    state.executeTimelineChange((timeline) => {
      const assetId = requiredString(args, "assetId");
      requireAsset(state.project.assets, assetId);
      let track = timeline.tracks.find(
        (candidate) => candidate.kind === "OverlayImage",
      );
      if (!track) {
        track = { id: randomUUID(), kind: "OverlayImage", items: [] };
        timeline.tracks.push(track);
      }
      addItem(timeline, track.id, {
        ImageOverlay: {
          id: randomUUID(),
          asset_id: assetId,
          track_id: track.id,
          timeline_start_us: requiredNumber(args, "timelineStartUs"),
          duration_us: requiredNumber(args, "durationUs"),
          x: requiredNumber(args, "x"),
          y: requiredNumber(args, "y"),
          width: requiredNumber(args, "width"),
          height: requiredNumber(args, "height"),
          opacity: requiredNumber(args, "opacity"),
        },
      });
    }),
  get_snap_points: (args, { state }) =>
    collectSnapPoints(
      state.activeSequence.timeline,
      optionalString(args, "excludeItemId"),
    ),
  get_sequence_frame: (args, { state }) =>
    resolveSequenceFrame(state.project, requiredNumber(args, "playheadUs")),
  set_clip_volume: (args, { state }) =>
    state.executeTimelineChange((timeline) => {
      const item = findItem(timeline, requiredString(args, "itemId"));
      const data = itemData(item);
      if (!("volume" in data)) throw new Error("Volume requires an audio clip");
      data.volume = requiredNumber(args, "volume");
    }),
  get_item_details: (args, { state }) => {
    const item = structuredClone(
      findItem(state.activeSequence.timeline, requiredString(args, "itemId")),
    );
    const data = itemData(item);
    const assetId = assetIdOf(item);
    if (assetId) {
      const asset = state.project.assets.find(
        (candidate) => candidate.id === assetId,
      );
      if (asset) {
        (data as typeof data & { asset_name?: string }).asset_name = asset.name;
      }
    }
    return item;
  },
  update_item: (args, { state }) =>
    state.executeTimelineChange((timeline) => {
      const item = findItem(timeline, requiredString(args, "itemId"));
      const patch = args?.patch as ItemPatch;
      const data = patch && patch.kind in item ? itemData(item) : undefined;
      if (!data) throw new Error("Patch kind does not match the selected item");
      if (patch.kind === "RemotionGraphic" && "RemotionGraphic" in item) {
        const { props, layer_states, ...changes } = patch.changes;
        const states = { ...item.RemotionGraphic.layer_states };
        for (const [id, value] of Object.entries(layer_states ?? {}))
          states[id] = { ...states[id], ...value };
        const component = state.project.components?.find(
          (candidate) =>
            candidate.id === item.RemotionGraphic.component_id &&
            candidate.version === item.RemotionGraphic.component_version,
        );
        if (component && props) {
          const locked = lockedGraphicProperties(component, {
            ...item.RemotionGraphic,
            layer_states: states,
          });
          if (
            Object.entries(props).some(
              ([key, value]) =>
                locked.has(key) && item.RemotionGraphic.props[key] !== value,
            )
          )
            throw new EditingError(
              "CONFLICT",
              "Unlock this layer before editing its properties",
            );
        }
        Object.assign(item.RemotionGraphic, changes);
        if (layer_states) item.RemotionGraphic.layer_states = states;
        if (props)
          item.RemotionGraphic.props = {
            ...item.RemotionGraphic.props,
            ...props,
          };
      } else Object.assign(data, patch.changes);
    }),
} satisfies CommandRegistry;

function createTimelineItem(
  asset: Asset,
  trackId: string,
  timelineStartUs: number,
  range: { inUs?: number; outUs?: number },
): TimelineItem {
  const duration = asset.probe?.duration_us ?? 5_000_000;
  if (asset.kind === "Audio") {
    return {
      AudioClip: {
        id: randomUUID(),
        asset_id: asset.id,
        track_id: trackId,
        timeline_start_us: timelineStartUs,
        source_in_us: range.inUs ?? 0,
        source_out_us: range.outUs ?? duration,
        volume: 1,
      },
    };
  }
  if (asset.kind === "Image") {
    if (range.inUs !== undefined || range.outUs !== undefined)
      throw new Error("Source ranges require video or audio media");
    return {
      ImageOverlay: {
        id: randomUUID(),
        asset_id: asset.id,
        track_id: trackId,
        timeline_start_us: timelineStartUs,
        duration_us: 5_000_000,
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        opacity: 1,
      },
    };
  }
  return {
    VideoClip: {
      id: randomUUID(),
      asset_id: asset.id,
      track_id: trackId,
      timeline_start_us: timelineStartUs,
      source_in_us: range.inUs ?? 0,
      source_out_us: range.outUs ?? duration,
    },
  };
}

function requireAsset(assets: Asset[], assetId: string): Asset {
  const asset = assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error("Asset not found");
  return asset;
}

function ensureTrack(
  tracks: Track[],
  trackId: string,
  kind: Track["kind"],
): void {
  if (!tracks.some((track) => track.id === trackId)) {
    tracks.push({ id: trackId, kind, items: [] });
  }
}
