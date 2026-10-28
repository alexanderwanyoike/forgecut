import type {
  Project,
  VideoClipItem,
} from "../../../electron/shared/ipc-contract";
import {
  frameAtOrAfter,
  frameTimeUs,
  resolveSequenceFrame,
} from "../../../electron/domain/sequence";

export function nextVideoLayer(project: Project, playheadUs: number) {
  let next: VideoClipItem | undefined;
  for (const track of project.timeline.tracks) {
    for (const item of track.items) {
      if (!("VideoClip" in item)) continue;
      const clip = item.VideoClip;
      if (
        clip.timeline_start_us > playheadUs &&
        clip.timeline_start_us <= playheadUs + 2000000 &&
        (!next || clip.timeline_start_us < next.timeline_start_us)
      )
        next = clip;
    }
  }
  if (!next) return undefined;
  const timeUs = frameTimeUs(
    frameAtOrAfter(next.timeline_start_us, project.settings.fps),
    project.settings.fps,
  );
  return resolveSequenceFrame(project, timeUs).layers.find(
    (layer) => "VideoClip" in layer.item && layer.item.VideoClip.id === next.id,
  );
}
