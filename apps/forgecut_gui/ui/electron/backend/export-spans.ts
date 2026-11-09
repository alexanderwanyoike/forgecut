import type { ReviewWindow } from "../domain/review-range.js";
import {
  frameAtOrAfter,
  itemFrameRange,
  sequenceDurationUs,
} from "../domain/sequence.js";
import {
  orderedTimelineItems,
  resolveVisualPlacement,
} from "../domain/visual-placement.js";
import type { Project, TimelineItem } from "./state.js";

export type FrameRange = { start: number; end: number };
export type SpanLayer = FrameRange & { item: TimelineItem };
export type ExportSpan = FrameRange & { layers: SpanLayer[]; plain: boolean };

export function overlaps(a: FrameRange, b: FrameRange): boolean {
  return Math.min(a.end, b.end) > Math.max(a.start, b.start);
}

export function exportFrameRange(
  project: Project,
  window?: ReviewWindow,
): FrameRange {
  const { fps } = project.settings;
  if (!window)
    return { start: 0, end: frameAtOrAfter(sequenceDurationUs(project), fps) };
  const start = Math.round(window.startSeconds * fps);
  return { start, end: start + window.frameCount };
}

/**
 * Splits the export into spans whose visible items do not change. A span is
 * plain when it shows one opaque, full-frame video, so it needs no compositing.
 */
export function planExportSpans(
  project: Project,
  frames: FrameRange,
): ExportSpan[] {
  const visuals = orderedTimelineItems(project).flatMap(({ item }) => {
    if ("AudioClip" in item) return [];
    const range = itemFrameRange(item, project.settings.fps);
    return overlaps(range, frames) ? [{ ...range, item }] : [];
  });
  const cuts = [
    ...new Set([
      frames.start,
      frames.end,
      ...visuals
        .flatMap(({ start, end }) => [start, end])
        .filter((frame) => frame > frames.start && frame < frames.end),
    ]),
  ].sort((a, b) => a - b);
  return cuts.slice(1).map((end, index) => {
    const start = cuts[index];
    const layers = visuals.filter((layer) => overlaps(layer, { start, end }));
    return {
      start,
      end,
      layers,
      plain: layers.length === 1 && isPlainVideo(project, layers[0].item),
    };
  });
}

function isPlainVideo(project: Project, item: TimelineItem): boolean {
  // Prepared graphics carry an explicit transform and may hold alpha.
  if (!("VideoClip" in item) || item.VideoClip.transform) return false;
  const placement = resolveVisualPlacement(project, item);
  const { width, height } = project.settings;
  return (
    placement?.x === 0 &&
    placement.y === 0 &&
    placement.width === width &&
    placement.height === height &&
    placement.opacity === 1
  );
}
