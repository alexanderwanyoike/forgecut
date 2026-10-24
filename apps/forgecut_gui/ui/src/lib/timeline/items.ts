import {
  itemData,
  itemVariant,
  durationUs,
} from "../../../electron/domain/timeline-item";
import type {
  Timeline,
  TimelineItem,
  TimelineItemVariant,
} from "../../../electron/shared/ipc-contract";
import { LABEL_W, usToPixels } from "./geometry";

export type {
  Timeline,
  TimelineItem,
  Track,
} from "../../../electron/shared/ipc-contract";

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
  const data = itemData(item);
  return {
    variant: itemVariant(item),
    ...data,
    ...("RemotionGraphic" in item
      ? {
          text:
            typeof item.RemotionGraphic.props.title === "string" &&
            item.RemotionGraphic.props.title.trim()
              ? item.RemotionGraphic.props.title
              : "Graphic",
        }
      : {}),
    startUs: data.timeline_start_us,
    durationUs: durationUs(item),
  };
}

export function timelineMaxEndUs(timeline: Timeline, floorUs: number): number {
  let maxEnd = Math.max(floorUs, timeline.duration_us ?? 0);
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
export function timelineContentWidth(
  timeline: Timeline,
  pixelsPerSecond: number,
): number {
  const maxEnd = timelineMaxEndUs(timeline, 30_000_000);
  return usToPixels(maxEnd + 5_000_000, pixelsPerSecond) + LABEL_W;
}
