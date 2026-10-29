import type {
  Project,
  SequenceFrame,
  TimelineItem,
  TimelineItemDetail,
} from "../shared/ipc-contract.js";
import {
  assetIdOf,
  itemData,
  timelineStartUs,
  timelineEndUs,
} from "./timeline-item.js";

import { audioGainAt } from "./audio.js";

import {
  orderedTimelineItems,
  resolveVisualPlacement,
} from "./visual-placement.js";

// Serialized frame boundaries can differ by half a microsecond after rounding.
export function frameAtOrAfter(timeUs: number, fps: number): number {
  return Math.ceil(((timeUs - 0.5) * fps) / 1_000_000 - 1e-9);
}

export function frameTimeUs(frame: number, fps: number): number {
  return Math.round((frame * 1_000_000) / fps);
}

export function sequenceDurationUs(project: Project): number {
  const end = project.timeline.tracks.reduce(
    (longest, track) =>
      track.items.reduce(
        (max, item) => Math.max(max, timelineEndUs(item)),
        longest,
      ),
    0,
  );
  return frameTimeUs(
    frameAtOrAfter(project.timeline.duration_us ?? end, project.settings.fps),
    project.settings.fps,
  );
}

export function itemFrameRange(item: TimelineItem, fps: number) {
  return {
    start: frameAtOrAfter(timelineStartUs(item), fps),
    end: frameAtOrAfter(timelineEndUs(item), fps),
  };
}

export function resolveSequenceFrame(
  project: Project,
  playheadUs: number,
): SequenceFrame {
  const { fps } = project.settings;
  const frame = Math.floor(((playheadUs + 0.5) * fps) / 1_000_000 + 1e-9);
  const durationUs = sequenceDurationUs(project);
  const layers = orderedTimelineItems(project).flatMap(
    ({ item, trackIndex }) => {
      const range = itemFrameRange(item, fps);
      if (
        frame >= frameAtOrAfter(durationUs, fps) ||
        frame < range.start ||
        frame >= range.end
      )
        return [];
      const data = itemData(item);
      const elapsedUs = Math.max(0, playheadUs - frameTimeUs(range.start, fps));
      const sourceTimeUs = sourceTimeAt(
        data,
        frameTimeUs(frame - range.start, fps),
      );
      const playbackTimeUs = sourceTimeAt(data, elapsedUs);
      const asset =
        project.assets.find((candidate) => candidate.id === assetIdOf(item)) ??
        null;
      const audible =
        "AudioClip" in item ||
        ("VideoClip" in item && (asset?.probe?.audio_channels ?? 0) > 0);
      return [
        {
          item,
          trackIndex,
          placement: resolveVisualPlacement(project, item),
          asset,
          audioGain: audible
            ? audioGainAt(
                item,
                elapsedUs,
                frameTimeUs(range.end - range.start, fps),
              )
            : undefined,
          sourceTimeUs,
          playbackTimeUs,
        },
      ];
    },
  );
  return {
    frame,
    frameCount: frameAtOrAfter(durationUs, fps),
    durationUs,
    settings: project.settings,
    layers,
  };
}

function sourceTimeAt(
  data: TimelineItemDetail,
  offsetUs: number,
): number | undefined {
  return "source_in_us" in data
    ? Math.min(data.source_out_us - 1, data.source_in_us + offsetUs)
    : undefined;
}
