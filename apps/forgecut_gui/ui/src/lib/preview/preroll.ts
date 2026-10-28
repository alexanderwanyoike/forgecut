import type {
  Project,
  SequenceFrame,
} from "../../../electron/shared/ipc-contract";
import {
  frameTimeUs,
  itemFrameRange,
  resolveSequenceFrame,
} from "../../../electron/domain/sequence";
import { itemData } from "../../../electron/domain/timeline-item";

const PREROLL_US = 2_000_000;

/**
 * Media layers starting within the preroll window, nearest first, resolved at
 * their first frame so their sources can be decoded and parked before the cut.
 */
export function upcomingLayers(
  project: Project,
  currentFrame: number,
): SequenceFrame["layers"] {
  const { fps } = project.settings;
  const lastFrame = currentFrame + Math.ceil((PREROLL_US * fps) / 1_000_000);
  return project.timeline.tracks
    .flatMap((track) => track.items)
    .filter(
      (item) =>
        ("VideoClip" in item ||
          "AudioClip" in item ||
          "RemotionGraphic" in item) &&
        itemFrameRange(item, fps).start > currentFrame &&
        itemFrameRange(item, fps).start <= lastFrame,
    )
    .sort((a, b) => itemFrameRange(a, fps).start - itemFrameRange(b, fps).start)
    .flatMap((item) => {
      const { id } = itemData(item);
      return resolveSequenceFrame(
        project,
        frameTimeUs(itemFrameRange(item, fps).start, fps),
      ).layers.filter((layer) => itemData(layer.item).id === id);
    });
}
