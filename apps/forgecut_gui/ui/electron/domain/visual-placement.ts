import type {
  Project,
  TimelineItem,
  VisualPlacement,
} from "../shared/ipc-contract.js";
import { itemData } from "./timeline-item.js";

export function orderedTimelineItems(project: Project) {
  return project.timeline.tracks
    .flatMap((track, trackIndex) =>
      track.items.map((item) => ({ item, trackIndex })),
    )
    .sort((a, b) => layerOrder(a) - layerOrder(b));
}
function layerOrder(layer: { item: TimelineItem; trackIndex: number }): number {
  const data = itemData(layer.item);
  return "layer_order" in data
    ? (data.layer_order ?? layer.trackIndex)
    : layer.trackIndex;
}

export function resolveVisualPlacement(
  project: Project,
  item: TimelineItem,
): VisualPlacement | undefined {
  let placement: VisualPlacement;
  if ("ImageOverlay" in item) {
    placement = {
      ...item.ImageOverlay,
      fit: item.ImageOverlay.fit ?? "contain",
    };
  } else if ("RemotionGraphic" in item) {
    placement = item.RemotionGraphic.transform ?? {
      x: 0,
      y: 0,
      width: project.settings.width,
      height: project.settings.height,
      opacity: 1,
      fit: "contain",
    };
  } else if ("VideoClip" in item) {
    const { width, height } = project.settings;
    const primary = project.timeline.tracks.find(
      (track) => track.kind === "Video",
    )?.id;
    const pip = item.VideoClip.track_id !== primary;
    const targetWidth = pip ? Math.trunc(width / 4) : width;
    const targetHeight = pip ? Math.trunc(height / 4) : height;
    placement = item.VideoClip.transform ?? {
      x: pip ? width - targetWidth - 20 : 0,
      y: pip ? height - targetHeight - 20 : 0,
      width: targetWidth,
      height: targetHeight,
      opacity: 1,
      fit: "contain",
    };
  } else return undefined;
  return {
    x: Math.round(placement.x),
    y: Math.round(placement.y),
    width: Math.max(1, Math.round(placement.width)),
    height: Math.max(1, Math.round(placement.height)),
    opacity: placement.opacity,
    fit: placement.fit,
  };
}
