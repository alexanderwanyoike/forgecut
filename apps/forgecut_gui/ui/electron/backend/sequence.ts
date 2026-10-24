import type {
  Project,
  SequenceFrame,
  TimelineItem,
} from "../shared/ipc-contract.js";
import {
  assetIdOf,
  itemData,
  timelineStartUs,
  timelineEndUs,
} from "./timeline-ops.js";

export function frameAtOrAfter(timeUs: number, fps: number): number {
  return Math.ceil((timeUs * fps) / 1_000_000 - 1e-9);
}

export function frameTimeUs(frame: number, fps: number): number {
  return Math.round((frame * 1_000_000) / fps);
}

export function sequenceDurationUs(project: Project): number {
  const end = Math.max(
    0,
    ...project.timeline.tracks.flatMap((track) =>
      track.items.map(timelineEndUs),
    ),
  );
  return frameTimeUs(
    frameAtOrAfter(end, project.settings.fps),
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
  const frame = Math.floor((playheadUs * fps) / 1_000_000 + 1e-9);
  const durationUs = sequenceDurationUs(project);
  const layers = project.timeline.tracks.flatMap((track, trackIndex) =>
    track.items.flatMap((item) => {
      const range = itemFrameRange(item, fps);
      if (frame < range.start || frame >= range.end) return [];
      const data = itemData(item);
      const sourceTimeUs =
        "source_in_us" in data
          ? Math.min(
              data.source_out_us - 1,
              data.source_in_us + frameTimeUs(frame - range.start, fps),
            )
          : undefined;
      return [
        {
          item,
          trackIndex,
          asset:
            project.assets.find((asset) => asset.id === assetIdOf(item)) ??
            null,
          sourceTimeUs,
        },
      ];
    }),
  );
  return {
    frame,
    frameCount: frameAtOrAfter(durationUs, fps),
    durationUs,
    settings: project.settings,
    layers,
  };
}
