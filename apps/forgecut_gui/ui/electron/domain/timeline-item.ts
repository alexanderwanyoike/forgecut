import type {
  TimelineItem,
  TimelineItemDetail,
  TimelineItemVariant,
  TimeUs,
} from "../shared/ipc-contract.js";

export function itemData(item: TimelineItem): TimelineItemDetail {
  if ("VideoClip" in item) return item.VideoClip;
  if ("AudioClip" in item) return item.AudioClip;
  if ("ImageOverlay" in item) return item.ImageOverlay;
  return item.TextOverlay;
}

export function itemVariant(item: TimelineItem): TimelineItemVariant {
  if ("VideoClip" in item) return "VideoClip";
  if ("AudioClip" in item) return "AudioClip";
  if ("ImageOverlay" in item) return "ImageOverlay";
  return "TextOverlay";
}

export function itemIdOf(item: TimelineItem): string {
  return itemData(item).id;
}

export function trackIdOf(item: TimelineItem): string {
  return itemData(item).track_id;
}

export function assetIdOf(item: TimelineItem): string | undefined {
  const data = itemData(item);
  return "asset_id" in data ? data.asset_id : undefined;
}

export function timelineStartUs(item: TimelineItem): TimeUs {
  return itemData(item).timeline_start_us;
}

export function durationUs(item: TimelineItem): TimeUs {
  const data = itemData(item);
  if ("source_in_us" in data && "source_out_us" in data) {
    return data.source_out_us - data.source_in_us;
  }
  return data.duration_us;
}

export function timelineEndUs(item: TimelineItem): TimeUs {
  return timelineStartUs(item) + durationUs(item);
}
