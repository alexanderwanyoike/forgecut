import { randomUUID } from "node:crypto";
import type {
  Timeline,
  TimelineItem,
  TimelineItemDetail,
  TimelineItemVariant,
  Track,
  TimeUs,
} from "./state.js";

export type ItemDetails = TimelineItemDetail;

export function addItem(timeline: Timeline, trackId: string, item: TimelineItem): void {
  const track = findTrack(timeline, trackId);
  for (const existing of track.items) {
    if (itemsOverlap(existing, item)) {
      throw new Error("Overlap detected");
    }
  }
  track.items.push(item);
}

export function removeItem(timeline: Timeline, itemId: string): TimelineItem {
  for (const track of timeline.tracks) {
    const index = track.items.findIndex((item) => itemIdOf(item) === itemId);
    if (index !== -1) {
      return track.items.splice(index, 1)[0];
    }
  }
  throw new Error(`Item not found: ${itemId}`);
}

export function moveItem(timeline: Timeline, itemId: string, newStartUs: TimeUs): void {
  const { track, item, index } = findItemLocation(timeline, itemId);
  track.items.splice(index, 1);
  const originalStart = timelineStartUs(item);
  setTimelineStartUs(item, newStartUs);

  try {
    assertNoOverlap(track, item);
    track.items.push(item);
  } catch (error) {
    setTimelineStartUs(item, originalStart);
    track.items.splice(index, 0, item);
    throw error;
  }
}

export function moveItemToTrack(
  timeline: Timeline,
  itemId: string,
  newTrackId: string,
  newStartUs: TimeUs,
): void {
  const source = findItemLocation(timeline, itemId);
  if (source.track.id === newTrackId) {
    moveItem(timeline, itemId, newStartUs);
    return;
  }

  const target = findTrack(timeline, newTrackId);
  if (source.track.kind !== target.kind) {
    throw new Error("cannot move item to a track of a different kind");
  }

  source.track.items.splice(source.index, 1);
  const originalStart = timelineStartUs(source.item);
  const originalTrackId = trackIdOf(source.item);
  setTimelineStartUs(source.item, newStartUs);
  setTrackId(source.item, newTrackId);

  try {
    assertNoOverlap(target, source.item);
    target.items.push(source.item);
  } catch (error) {
    setTimelineStartUs(source.item, originalStart);
    setTrackId(source.item, originalTrackId);
    source.track.items.splice(source.index, 0, source.item);
    throw error;
  }
}

export function trimIn(timeline: Timeline, itemId: string, newInUs: TimeUs): void {
  const { track, item, index } = findItemLocation(timeline, itemId);
  const end = timelineEndUs(item);
  const data = itemData(item);

  if ("source_in_us" in data && "source_out_us" in data) {
    if (newInUs >= data.source_out_us) {
      throw new Error("source_in must be less than source_out");
    }
    data.source_in_us = newInUs;
    data.timeline_start_us = end - (data.source_out_us - newInUs);
  } else {
    if (newInUs >= end) {
      throw new Error("new start must be before end");
    }
    data.duration_us = end - newInUs;
    data.timeline_start_us = newInUs;
  }

  assertNoOverlap(track, item, index);
}

export function trimOut(timeline: Timeline, itemId: string, newOutUs: TimeUs): void {
  const { track, item, index } = findItemLocation(timeline, itemId);
  const data = itemData(item);

  if ("source_in_us" in data && "source_out_us" in data) {
    if (newOutUs <= data.source_in_us) {
      throw new Error("source_out must be greater than source_in");
    }
    data.source_out_us = newOutUs;
  } else {
    const duration = newOutUs - data.timeline_start_us;
    if (duration <= 0) {
      throw new Error("new out must be after start");
    }
    data.duration_us = duration;
  }

  assertNoOverlap(track, item, index);
}

export function splitAt(timeline: Timeline, itemId: string, splitTimeUs: TimeUs): void {
  const { track, item, index } = findItemLocation(timeline, itemId);
  const start = timelineStartUs(item);
  const end = timelineEndUs(item);
  if (splitTimeUs <= start || splitTimeUs >= end) {
    throw new Error("split position must be strictly between item start and end");
  }

  const variant = itemVariant(item);
  const data = itemData(item);
  const rightId = randomUUID();

  if (variant === "VideoClip" || variant === "AudioClip") {
    const clip = data as Extract<ItemDetails, { source_in_us: number }>;
    const splitSource = clip.source_in_us + (splitTimeUs - clip.timeline_start_us);
    const right = structuredClone(item);
    const rightData = itemData(right) as typeof clip;
    clip.source_out_us = splitSource;
    rightData.id = rightId;
    rightData.timeline_start_us = splitTimeUs;
    rightData.source_in_us = splitSource;
    track.items.splice(index + 1, 0, right);
    return;
  }

  const overlay = data as Extract<ItemDetails, { duration_us: number }>;
  const right = structuredClone(item);
  const rightData = itemData(right) as typeof overlay;
  overlay.duration_us = splitTimeUs - overlay.timeline_start_us;
  rightData.id = rightId;
  rightData.timeline_start_us = splitTimeUs;
  rightData.duration_us = end - splitTimeUs;
  track.items.splice(index + 1, 0, right);
}

export function collectSnapPoints(timeline: Timeline, excludeItemId?: string): TimeUs[] {
  const points = new Set<TimeUs>([0]);
  for (const track of timeline.tracks) {
    for (const item of track.items) {
      if (itemIdOf(item) === excludeItemId) continue;
      points.add(timelineStartUs(item));
      points.add(timelineEndUs(item));
    }
  }
  for (const marker of timeline.markers as Array<{ time_us?: number }>) {
    if (typeof marker.time_us === "number") points.add(marker.time_us);
  }
  return [...points].sort((a, b) => a - b);
}

export function findItem(timeline: Timeline, itemId: string): TimelineItem {
  return findItemLocation(timeline, itemId).item;
}

export function findItemLocation(timeline: Timeline, itemId: string): {
  track: Track;
  item: TimelineItem;
  index: number;
} {
  for (const track of timeline.tracks) {
    const index = track.items.findIndex((item) => itemIdOf(item) === itemId);
    if (index !== -1) {
      return { track, item: track.items[index], index };
    }
  }
  throw new Error(`Item not found: ${itemId}`);
}

export function itemData(item: TimelineItem): ItemDetails {
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

function findTrack(timeline: Timeline, trackId: string): Track {
  const track = timeline.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new Error(`Track not found: ${trackId}`);
  return track;
}

function setTimelineStartUs(item: TimelineItem, newStartUs: TimeUs): void {
  itemData(item).timeline_start_us = newStartUs;
}

function setTrackId(item: TimelineItem, newTrackId: string): void {
  itemData(item).track_id = newTrackId;
}

function assertNoOverlap(track: Track, item: TimelineItem, selfIndex?: number): void {
  for (const [index, existing] of track.items.entries()) {
    if (index === selfIndex) continue;
    if (itemsOverlap(existing, item)) {
      throw new Error("Overlap detected");
    }
  }
}

function itemsOverlap(a: TimelineItem, b: TimelineItem): boolean {
  return timelineStartUs(a) < timelineEndUs(b) && timelineStartUs(b) < timelineEndUs(a);
}
