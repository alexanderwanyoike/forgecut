import { randomUUID } from "node:crypto";
import type { Asset, TimelineItem, Track } from "../state.js";
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
  timelineEndUs,
  timelineStartUs,
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
  get_timeline: (_args, { state }) => state.project.timeline,
  init_default_tracks: (_args, { state }) => state.initDefaultTracks(),
  add_clip_to_timeline: (args, { state }) =>
    state.executeTimelineChange((timeline) => {
      const assetId = requiredString(args, "assetId");
      const trackId = requiredString(args, "trackId");
      const timelineStartUs = requiredNumber(args, "timelineStartUs");
      const asset = requireAsset(state.project.assets, assetId);
      addItem(timeline, trackId, createTimelineItem(asset, trackId, timelineStartUs));
    }),
  trim_clip: (args, { state }) =>
    state.executeTimelineChange((timeline) => {
      const trimType = requiredString(args, "trimType");
      const itemId = requiredString(args, "itemId");
      const newUs = requiredNumber(args, "newUs");
      if (trimType === "in") {
        trimIn(timeline, itemId, newUs);
      } else {
        trimOut(timeline, itemId, newUs);
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
      if (!["Video", "Audio", "OverlayImage", "OverlayText"].includes(kind)) {
        throw new Error(`Unknown track kind: ${kind}`);
      }
      timeline.tracks.push({ id: randomUUID(), kind, items: [] });
    }),
  add_text_overlay: (args, { state }) =>
    state.executeTimelineChange((timeline) => {
      const trackId = requiredString(args, "trackId");
      ensureTrack(timeline.tracks, trackId, "OverlayText");
      const overlayTrack = timeline.tracks.find((track) => track.kind === "OverlayText");
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
      let track = timeline.tracks.find((candidate) => candidate.kind === "OverlayImage");
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
      state.project.timeline,
      optionalString(args, "excludeItemId"),
    ),
  get_clip_at_playhead: (args, { state }) => {
    const playheadUs = requiredNumber(args, "playheadUs");
    return findClipAtPlayhead(state.project.assets, state.project.timeline.tracks, playheadUs);
  },
  get_overlays_at_time: (args, { state }) => {
    const playheadUs = requiredNumber(args, "playheadUs");
    return state.project.timeline.tracks
      .filter((track) => track.kind === "OverlayImage" || track.kind === "OverlayText")
      .flatMap((track) => track.items)
      .filter((item) => playheadUs >= timelineStartUs(item) && playheadUs < timelineEndUs(item))
      .map((item) => withOverlayAssetPath(item, state.project.assets));
  },
  set_clip_volume: (args, { state }) =>
    state.executeTimelineChange((timeline) => {
      const item = findItem(timeline, requiredString(args, "itemId"));
      const data = itemData(item);
      if (!("volume" in data)) return;
      data.volume = requiredNumber(args, "volume");
    }),
  get_item_details: (args, { state }) => {
    const item = structuredClone(findItem(state.project.timeline, requiredString(args, "itemId")));
    const data = itemData(item);
    const assetId = assetIdOf(item);
    if (assetId) {
      const asset = state.project.assets.find((candidate) => candidate.id === assetId);
      if (asset) {
        (data as typeof data & { asset_name?: string }).asset_name = asset.name;
      }
    }
    return item;
  },
  update_item_property: (args, { state }) =>
    state.executeTimelineChange((timeline) => {
      const item = findItem(timeline, requiredString(args, "itemId"));
      updateItemProperty(
        item,
        requiredString(args, "property"),
        args?.value,
      );
    }),
} satisfies CommandRegistry;

function createTimelineItem(
  asset: Asset,
  trackId: string,
  timelineStartUs: number,
): TimelineItem {
  const duration = asset.probe?.duration_us ?? 5_000_000;
  if (asset.kind === "Audio") {
    return {
      AudioClip: {
        id: randomUUID(),
        asset_id: asset.id,
        track_id: trackId,
        timeline_start_us: timelineStartUs,
        source_in_us: 0,
        source_out_us: duration,
        volume: 1,
      },
    };
  }
  if (asset.kind === "Image") {
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
      source_in_us: 0,
      source_out_us: duration,
    },
  };
}

function requireAsset(assets: Asset[], assetId: string): Asset {
  const asset = assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error("Asset not found");
  return asset;
}

function ensureTrack(tracks: Track[], trackId: string, kind: Track["kind"]): void {
  if (!tracks.some((track) => track.kind === kind)) {
    tracks.push({ id: trackId, kind, items: [] });
  }
}

function findClipAtPlayhead(assets: Asset[], tracks: Track[], playheadUs: number) {
  for (const track of tracks) {
    for (const item of track.items) {
      if (playheadUs < timelineStartUs(item) || playheadUs >= timelineEndUs(item)) {
        continue;
      }

      const assetId = assetIdOf(item);
      if (!assetId) continue;
      const asset = assets.find((candidate) => candidate.id === assetId);
      if (!asset) continue;
      const data = itemData(item);
      const sourceInUs = "source_in_us" in data ? data.source_in_us : 0;
      const seekUs = sourceInUs + (playheadUs - timelineStartUs(item));

      return {
        file_path: asset.path,
        seek_seconds: seekUs / 1_000_000,
        clip_start_us: timelineStartUs(item),
        clip_end_us: timelineEndUs(item),
        source_in_us: sourceInUs,
      };
    }
  }
  return null;
}

function withOverlayAssetPath(item: TimelineItem, assets: Asset[]): TimelineItem {
  const clone = structuredClone(item);
  const assetId = assetIdOf(clone);
  if (!assetId) return clone;
  const asset = assets.find((candidate) => candidate.id === assetId);
  if (!asset) return clone;
  const data = itemData(clone);
  (data as typeof data & { file_path?: string }).file_path = asset.path;
  return clone;
}

function updateItemProperty(item: TimelineItem, property: string, value: unknown): void {
  if ("VideoClip" in item) return;
  if ("AudioClip" in item) {
    if (property !== "volume" || typeof value !== "number") {
      throw new Error(`Unknown property: ${property}`);
    }
    item.AudioClip.volume = value;
    return;
  }

  if ("TextOverlay" in item) {
    if (property === "text" && typeof value === "string") item.TextOverlay.text = value;
    else if (property === "font_size" && typeof value === "number") item.TextOverlay.font_size = value;
    else if (property === "color" && typeof value === "string") item.TextOverlay.color = value;
    else if (property === "x" && typeof value === "number") item.TextOverlay.x = value;
    else if (property === "y" && typeof value === "number") item.TextOverlay.y = value;
    else throw new Error(`Unknown property: ${property}`);
    return;
  }

  if (property === "x" && typeof value === "number") item.ImageOverlay.x = value;
  else if (property === "y" && typeof value === "number") item.ImageOverlay.y = value;
  else if (property === "width" && typeof value === "number") item.ImageOverlay.width = value;
  else if (property === "height" && typeof value === "number") item.ImageOverlay.height = value;
  else if (property === "opacity" && typeof value === "number") item.ImageOverlay.opacity = value;
  else throw new Error(`Unknown property: ${property}`);
}
