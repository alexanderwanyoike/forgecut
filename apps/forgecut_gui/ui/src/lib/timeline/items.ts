import type {
  Timeline,
  TimelineItem,
  TimelineItemVariant,
} from "../../../electron/shared/ipc-contract";
import { LABEL_W, usToPixels } from "./geometry";

export type { Timeline, TimelineItem, Track } from "../../../electron/shared/ipc-contract";

/** Flattened view of a timeline item for rendering. */
export type ItemView = {
  variant: TimelineItemVariant;
  id: string;
  startUs: number;
  durationUs: number;
  asset_id?: string;
  source_in_us?: number;
  source_out_us?: number;
  text?: string;
};

export function getItemData(item: TimelineItem): ItemView {
  const variant = Object.keys(item)[0] as TimelineItemVariant;
  const data = (item as Record<string, any>)[variant];
  const startUs = data.timeline_start_us;
  const durationUs =
    variant === "VideoClip" || variant === "AudioClip"
      ? data.source_out_us - data.source_in_us
      : data.duration_us;
  return { variant, ...data, startUs, durationUs };
}

export function timelineMaxEndUs(timeline: Timeline, floorUs: number): number {
  let maxEnd = floorUs;
  for (const track of timeline.tracks) {
    for (const item of track.items) {
      const data = getItemData(item);
      const end = data.startUs + data.durationUs;
      if (end > maxEnd) maxEnd = end;
    }
  }
  return maxEnd;
}

/** Total scrollable content width for the timeline at a given zoom. */
export function timelineContentWidth(timeline: Timeline, pixelsPerSecond: number): number {
  const maxEnd = timelineMaxEndUs(timeline, 30_000_000);
  return usToPixels(maxEnd + 5_000_000, pixelsPerSecond) + LABEL_W;
}
